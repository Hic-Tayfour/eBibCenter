(() => {
  "use strict";

  const catalogo = Array.isArray(window.CATALOGO) ? window.CATALOGO : [];
  const afinidade = window.MAPA_AFINIDADE || {};
  const redes = window.REDES_CITACOES || {};
  const redeGlobal = redes.global || {};
  const cache = new Map();
  let contextCache = null;
  let renderToken = 0;
  const minimumSimilarity = 0.25;
  const initialCollectionLimit = 12;

  const stopwords = new Set([
    "the", "and", "for", "with", "from", "into", "using", "of", "to", "in", "on", "a", "an",
    "de", "da", "do", "das", "dos", "e", "em", "para", "com", "uma", "um", "as", "os", "ao", "na", "no",
  ]);

  const clusterColors = [
    "var(--dendrogram-cluster-1)",
    "var(--dendrogram-cluster-2)",
    "var(--dendrogram-cluster-3)",
    "var(--dendrogram-cluster-4)",
    "var(--dendrogram-cluster-5)",
    "var(--dendrogram-cluster-6)",
    "var(--dendrogram-cluster-7)",
    "var(--dendrogram-cluster-8)",
  ];

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function tokens(value) {
    return [...new Set(normalize(value)
      .split(" ")
      .filter(word => word.length > 2 && !stopwords.has(word)))];
  }

  function keywords(record) {
    const match = String(record.bibtex || "").match(/keywords\s*=\s*\{([^}]*)\}/i);
    return match?.[1] || "";
  }

  function addFeature(features, name, weight) {
    if (!name) return;
    features.set(name, Math.max(weight, features.get(name) || 0));
  }

  function exactFeature(features, prefix, value, weight) {
    const normalized = normalize(value);
    if (normalized) addFeature(features, `${prefix}:${normalized}`, weight);
  }

  function wordFeatures(features, prefix, value, weight) {
    tokens(value).forEach(word => addFeature(features, `${prefix}:${word}`, weight));
  }

  function rawFeatures(record) {
    const features = new Map();
    wordFeatures(features, "title", record.titulo, 1);
    wordFeatures(features, "keyword", keywords(record), 1.2);
    exactFeature(features, "subject", record.assunto, 2.8);
    exactFeature(features, "subsubject", record.subassunto, 2.3);
    (record.tags || []).forEach(tag => exactFeature(features, "tag", tag, 3));
    exactFeature(features, "publication", record.publicacao, 1.7);
    (record.autores || []).forEach(author => exactFeature(features, "author", author, 0.8));
    exactFeature(features, "type", record.tipo, 0.25);
    return features;
  }

  function weightedFeatures(records) {
    const raw = records.map(rawFeatures);
    const frequencies = new Map();
    raw.forEach(features => {
      features.forEach((_, name) => frequencies.set(name, (frequencies.get(name) || 0) + 1));
    });
    const weighted = raw.map(features => {
      const result = new Map();
      features.forEach((base, name) => {
        const idf = Math.log((1 + records.length) / (1 + frequencies.get(name))) + 1;
        result.set(name, base * idf);
      });
      return result;
    });
    const norms = weighted.map(features => {
      let total = 0;
      features.forEach(value => { total += value * value; });
      return Math.sqrt(total) || 1;
    });
    return { weighted, norms };
  }

  function cosine(a, b, normA, normB) {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    let product = 0;
    small.forEach((value, name) => {
      if (large.has(name)) product += value * large.get(name);
    });
    return product / (normA * normB);
  }

  function pairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function relationIndex(edges, field, binary = false) {
    const index = new Map();
    (edges || []).forEach(edge => {
      if (!edge.source || !edge.target) return;
      const value = binary ? 1 : Number(edge[field]) || 0;
      const key = pairKey(edge.source, edge.target);
      index.set(key, Math.max(value, index.get(key) || 0));
    });
    return index;
  }

  const referenceSimilarity = relationIndex(afinidade.edges, "similarity");
  const directCitation = relationIndex(redeGlobal.edges, "confidence", true);
  const traceable = new Set((afinidade.nodes || []).map(node => node.id));

  class MinHeap {
    constructor() {
      this.values = [];
    }

    push(item) {
      const values = this.values;
      values.push(item);
      let index = values.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (values[parent][0] <= item[0]) break;
        values[index] = values[parent];
        index = parent;
      }
      values[index] = item;
    }

    pop() {
      const values = this.values;
      if (!values.length) return null;
      const root = values[0];
      const last = values.pop();
      if (!values.length) return root;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= values.length) break;
        const child = right < values.length && values[right][0] < values[left][0] ? right : left;
        if (values[child][0] >= last[0]) break;
        values[index] = values[child];
        index = child;
      }
      values[index] = last;
      return root;
    }
  }

  function averageLinkage(distance) {
    const n = distance.length;
    const capacity = 2 * n - 1;
    const matrix = Array.from({ length: capacity }, () => new Float64Array(capacity));
    const nodes = Array(capacity);
    const active = new Uint8Array(capacity);
    const sizes = new Uint32Array(capacity);
    const heap = new MinHeap();

    for (let i = 0; i < n; i += 1) {
      nodes[i] = { index: i, height: 0, size: 1, leaves: [i], minLeaf: i };
      active[i] = 1;
      sizes[i] = 1;
      for (let j = i + 1; j < n; j += 1) {
        matrix[i][j] = distance[i][j];
        matrix[j][i] = distance[i][j];
        heap.push([distance[i][j], i, j]);
      }
    }

    let next = n;
    let remaining = n;
    while (remaining > 1) {
      let candidate = heap.pop();
      while (candidate && (!active[candidate[1]] || !active[candidate[2]])) candidate = heap.pop();
      if (!candidate) throw new Error("Não foi possível concluir a clusterização.");
      const [height, first, second] = candidate;
      let left = first;
      let right = second;
      if (nodes[left].minLeaf > nodes[right].minLeaf) [left, right] = [right, left];
      const mergedSize = sizes[first] + sizes[second];
      nodes[next] = {
        left: nodes[left],
        right: nodes[right],
        height,
        size: mergedSize,
        leaves: [...nodes[left].leaves, ...nodes[right].leaves],
        minLeaf: Math.min(nodes[left].minLeaf, nodes[right].minLeaf),
      };
      active[first] = 0;
      active[second] = 0;
      active[next] = 1;
      sizes[next] = mergedSize;
      for (let k = 0; k < next; k += 1) {
        if (!active[k]) continue;
        const nextDistance = (
          sizes[first] * matrix[first][k] + sizes[second] * matrix[second][k]
        ) / mergedSize;
        matrix[next][k] = nextDistance;
        matrix[k][next] = nextDistance;
        heap.push([nextDistance, k, next]);
      }
      next += 1;
      remaining -= 1;
    }
    return nodes[next - 1];
  }

  function cutTree(root, k) {
    const groups = [root];
    while (groups.length < k) {
      let splitIndex = -1;
      let splitHeight = -1;
      groups.forEach((node, index) => {
        if (node.left && node.height > splitHeight) {
          splitHeight = node.height;
          splitIndex = index;
        }
      });
      if (splitIndex < 0) break;
      const [node] = groups.splice(splitIndex, 1);
      groups.push(node.left, node.right);
    }
    return groups.sort((a, b) => a.minLeaf - b.minLeaf);
  }

  function silhouette(distance, groups) {
    if (groups.length < 2) return 0;
    let total = 0;
    groups.forEach((group, groupIndex) => {
      group.leaves.forEach(i => {
        if (group.leaves.length === 1) return;
        const own = group.leaves.reduce((sum, j) => sum + (i === j ? 0 : distance[i][j]), 0)
          / (group.leaves.length - 1);
        let nearest = Infinity;
        groups.forEach((other, otherIndex) => {
          if (otherIndex === groupIndex) return;
          const average = other.leaves.reduce((sum, j) => sum + distance[i][j], 0) / other.leaves.length;
          nearest = Math.min(nearest, average);
        });
        total += (nearest - own) / Math.max(own, nearest, Number.EPSILON);
      });
    });
    return total / distance.length;
  }

  function buildModel(inputRecords) {
    const records = [...inputRecords].sort((a, b) =>
      a.titulo.localeCompare(b.titulo, "pt-BR", { sensitivity: "base" })
    );
    const key = records.map(record => record.id).join("|");
    if (cache.has(key)) return cache.get(key);

    const { weighted, norms } = weightedFeatures(records);
    const n = records.length;
    const distance = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const metadata = cosine(weighted[i], weighted[j], norms[i], norms[j]);
        const relation = pairKey(records[i].id, records[j].id);
        const references = referenceSimilarity.get(relation) || 0;
        const citation = directCitation.get(relation) || 0;
        const bothTraceable = traceable.has(records[i].id) && traceable.has(records[j].id);
        const similarity = bothTraceable
          ? 0.70 * metadata + 0.25 * references + 0.05 * citation
          : 0.95 * metadata + 0.05 * citation;
        const value = 1 - Math.max(0, Math.min(1, similarity));
        distance[i][j] = value;
        distance[j][i] = value;
      }
    }

    const root = averageLinkage(distance);
    const maximumK = Math.min(80, Math.max(2, n - 1));
    const silhouetteByK = new Map();
    let bestK = 2;
    let bestSilhouette = -Infinity;
    for (let k = 2; k <= maximumK; k += 1) {
      const value = silhouette(distance, cutTree(root, k));
      silhouetteByK.set(k, value);
      if (value > bestSilhouette) {
        bestSilhouette = value;
        bestK = k;
      }
    }
    if (n === 2) {
      bestK = 2;
      bestSilhouette = 0;
      silhouetteByK.set(2, 0);
    }

    const model = {
      records,
      distance,
      root,
      maximumK: Math.min(maximumK, n),
      bestK,
      bestSilhouette,
      silhouetteByK,
      traceableCount: records.filter(record => traceable.has(record.id)).length,
    };
    cache.set(key, model);
    if (cache.size > 4) cache.delete(cache.keys().next().value);
    return model;
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function wrapTitle(value, width = 48, lines = 2) {
    const words = String(value || "").split(/\s+/);
    const result = [];
    let current = "";
    words.forEach(word => {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= width || !current) current = candidate;
      else {
        result.push(current);
        current = word;
      }
    });
    if (current) result.push(current);
    if (result.length <= lines) return result;
    const visible = result.slice(0, lines);
    visible[lines - 1] = `${visible[lines - 1].slice(0, Math.max(1, width - 1)).trim()}…`;
    return visible;
  }

  function nodeCluster(node, assignments) {
    const values = new Set(node.leaves.map(index => assignments[index]));
    return values.size === 1 ? [...values][0] : null;
  }

  function dominantSubject(group, records) {
    const counts = new Map();
    group.leaves.forEach(index => {
      const subject = records[index].assunto || "Sem assunto";
      counts.set(subject, (counts.get(subject) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))[0]?.[0] || "Sem assunto";
  }

  function dominantValue(leaves, records, field, fallback) {
    const counts = new Map();
    leaves.forEach(index => {
      const value = records[index][field] || fallback;
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    const [value, count] = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "pt-BR"))[0] || [fallback, 0];
    return { value, count, share: leaves.length ? count / leaves.length : 0 };
  }

  function connectedComponents(leaves, distance, threshold) {
    const pending = new Set(leaves);
    const components = [];
    while (pending.size) {
      const first = pending.values().next().value;
      pending.delete(first);
      const component = [first];
      const queue = [first];
      while (queue.length) {
        const current = queue.shift();
        [...pending].forEach(candidate => {
          if (1 - distance[current][candidate] >= threshold) {
            pending.delete(candidate);
            component.push(candidate);
            queue.push(candidate);
          }
        });
      }
      components.push(component);
    }
    return components;
  }

  function medoid(leaves, distance) {
    return leaves.reduce((best, candidate) => {
      const average = leaves.reduce((sum, other) => sum + distance[candidate][other], 0)
        / Math.max(1, leaves.length - 1);
      return !best || average < best.average ? { index: candidate, average } : best;
    }, null).index;
  }

  function evidenceLevel(score) {
    if (score >= 0.62) return { code: "forte", label: "Forte" };
    if (score >= 0.45) return { code: "moderada", label: "Moderada" };
    return { code: "exploratoria", label: "Exploratória" };
  }

  function describeCollection(leaves, model) {
    const representativeIndex = medoid(leaves, model.distance);
    const nearest = leaves.map(index => {
      const similarities = leaves
        .filter(other => other !== index)
        .map(other => 1 - model.distance[index][other]);
      return Math.max(...similarities);
    });
    const proximity = nearest.reduce((sum, value) => sum + value, 0) / nearest.length;
    let referencePairs = 0;
    let citationPairs = 0;
    for (let i = 0; i < leaves.length; i += 1) {
      for (let j = i + 1; j < leaves.length; j += 1) {
        const first = model.records[leaves[i]].id;
        const second = model.records[leaves[j]].id;
        if ((referenceSimilarity.get(pairKey(first, second)) || 0) > 0) referencePairs += 1;
        if ((directCitation.get(pairKey(first, second)) || 0) > 0) citationPairs += 1;
      }
    }
    const subject = dominantValue(leaves, model.records, "assunto", "Sem assunto");
    const subsubject = dominantValue(leaves, model.records, "subassunto", "Sem subassunto");
    const publication = dominantValue(leaves, model.records, "publicacao", "Publicação não identificada");
    const title = subject.share >= 0.5
      ? (subsubject.share >= 0.5 && normalize(subsubject.value) !== normalize(subject.value)
        ? `${subject.value} · ${subsubject.value}`
        : subject.value)
      : "Coleção interdisciplinar";
    const evidence = [];
    if (subject.share >= 0.5) evidence.push(`${subject.value} em ${Math.round(subject.share * 100)}%`);
    if (subsubject.share >= 0.6 && normalize(subsubject.value) !== normalize(subject.value)) {
      evidence.push(`${subsubject.value} em ${Math.round(subsubject.share * 100)}%`);
    }
    if (publication.share >= 0.7) evidence.push(`${publication.value} em ${Math.round(publication.share * 100)}%`);
    if (referencePairs) evidence.push(`${referencePairs} ${referencePairs === 1 ? "par com referências compartilhadas" : "pares com referências compartilhadas"}`);
    if (citationPairs) evidence.push(`${citationPairs} ${citationPairs === 1 ? "citação local direta" : "citações locais diretas"}`);
    if (!referencePairs && !citationPairs) evidence.push("aproximação sustentada por metadados");
    const orderedLeaves = [...leaves].sort((a, b) => {
      if (a === representativeIndex) return -1;
      if (b === representativeIndex) return 1;
      return model.distance[representativeIndex][a] - model.distance[representativeIndex][b];
    });
    return {
      leaves: orderedLeaves,
      title,
      subject,
      subsubject,
      publication,
      representativeIndex,
      proximity,
      evidence,
      level: evidenceLevel(proximity),
      traceableCount: leaves.filter(index => traceable.has(model.records[index].id)).length,
    };
  }

  function analyzeCollections(model, k) {
    const rawGroups = cutTree(model.root, k);
    const components = rawGroups.flatMap(group =>
      connectedComponents(group.leaves, model.distance, minimumSimilarity)
    );
    const grouped = components
      .filter(component => component.length > 1)
      .map(component => describeCollection(component, model))
      .sort((a, b) => b.leaves.length - a.leaves.length || b.proximity - a.proximity || a.title.localeCompare(b.title, "pt-BR"));
    grouped.forEach((collection, index) => {
      collection.code = `C${String(index + 1).padStart(2, "0")}`;
    });
    const unassigned = components.filter(component => component.length === 1).flat();
    return { rawGroups, collections: grouped, unassigned };
  }

  function pairReasons(first, second) {
    const reasons = [];
    if (first.assunto && normalize(first.assunto) === normalize(second.assunto)) reasons.push("mesmo assunto");
    if (first.subassunto && normalize(first.subassunto) === normalize(second.subassunto)) reasons.push("mesmo subassunto");
    if (first.publicacao && normalize(first.publicacao) === normalize(second.publicacao)) reasons.push("mesma publicação");
    const firstAuthors = new Set((first.autores || []).map(normalize));
    if ((second.autores || []).some(author => firstAuthors.has(normalize(author)))) reasons.push("autoria em comum");
    const firstTags = new Set((first.tags || []).map(normalize));
    if ((second.tags || []).some(tag => firstTags.has(normalize(tag)))) reasons.push("tags em comum");
    const relation = pairKey(first.id, second.id);
    if ((referenceSimilarity.get(relation) || 0) > 0) reasons.push("referências compartilhadas");
    if ((directCitation.get(relation) || 0) > 0) reasons.push("citação local direta");
    return reasons.length ? reasons : ["título e metadados próximos"];
  }

  function buildContextIndex() {
    if (contextCache) return contextCache;
    const model = buildModel(catalogo);
    const analysis = analyzeCollections(model, model.bestK);
    const index = new Map();
    analysis.collections.forEach(collection => {
      collection.leaves.forEach(recordIndex => {
        const record = model.records[recordIndex];
        const related = collection.leaves
          .filter(other => other !== recordIndex)
          .sort((a, b) => model.distance[recordIndex][a] - model.distance[recordIndex][b])
          .slice(0, 4)
          .map(other => ({
            id: model.records[other].id,
            title: model.records[other].titulo,
            similarity: 1 - model.distance[recordIndex][other],
            reasons: pairReasons(record, model.records[other]),
          }));
        index.set(record.id, {
          status: "grouped",
          id: record.id,
          code: collection.code,
          title: collection.title,
          ids: collection.leaves.map(other => model.records[other].id),
          size: collection.leaves.length,
          proximity: related[0]?.similarity || collection.proximity,
          level: evidenceLevel(related[0]?.similarity || collection.proximity),
          representative: model.records[collection.representativeIndex],
          evidence: collection.evidence,
          related,
        });
      });
    });
    analysis.unassigned.forEach(recordIndex => {
      const record = model.records[recordIndex];
      const nearest = model.records
        .map((candidate, indexValue) => ({ candidate, similarity: 1 - model.distance[recordIndex][indexValue] }))
        .filter(item => item.candidate.id !== record.id)
        .sort((a, b) => b.similarity - a.similarity)[0];
      index.set(record.id, {
        status: "unassigned",
        id: record.id,
        nearest: nearest ? {
          id: nearest.candidate.id,
          title: nearest.candidate.titulo,
          similarity: nearest.similarity,
          reasons: pairReasons(record, nearest.candidate),
        } : null,
      });
    });
    contextCache = index;
    return contextCache;
  }

  function collectionCard(collection, model, hidden = false) {
    const records = collection.leaves.map(index => model.records[index]);
    const representative = model.records[collection.representativeIndex];
    const examples = records.slice(0, 4);
    const extra = records.length - examples.length;
    const colorIndex = Number(collection.code.slice(1)) - 1;
    return `
      <article class="affinity-collection ${hidden ? "affinity-collection--hidden" : ""}" ${hidden ? "data-collection-secondary" : ""} style="--cluster-color:${clusterColors[colorIndex % clusterColors.length]}">
        <div class="affinity-collection__heading">
          <span class="affinity-collection__code">${collection.code}</span>
          <span class="affinity-confidence affinity-confidence--${collection.level.code}">${collection.level.label}</span>
        </div>
        <h4>${escapeHtml(collection.title)}</h4>
        <p class="affinity-collection__count">${records.length} obras · proximidade local ${Math.round(collection.proximity * 100)}%</p>
        <dl class="affinity-collection__metrics">
          <div><dt>Obra representativa</dt><dd><button type="button" data-cluster-open="${escapeHtml(representative.id)}">${escapeHtml(representative.titulo)}</button></dd></div>
          <div><dt>Base observada</dt><dd>${escapeHtml(collection.evidence.join(" · "))}</dd></div>
          <div><dt>Referências rastreáveis</dt><dd>${collection.traceableCount} de ${records.length} obras</dd></div>
        </dl>
        <ul class="affinity-collection__works">
          ${examples.map(record => `<li><button type="button" data-cluster-open="${escapeHtml(record.id)}">${escapeHtml(record.titulo)}</button></li>`).join("")}
          ${extra > 0 ? `<li class="affinity-collection__extra">+ ${extra} ${extra === 1 ? "obra" : "obras"}</li>` : ""}
        </ul>
        <div class="affinity-collection__actions">
          <button class="button affinity-collection__apply" type="button" data-cluster-apply="${collection.code}">Ver no catálogo</button>
          <button class="button button--quiet" type="button" data-cluster-select="${collection.code}">Selecionar coleção</button>
        </div>
      </article>`;
  }

  function renderSummary(container, groups, records) {
    const ordered = [...groups].sort((a, b) => b.size - a.size || a.minLeaf - b.minLeaf);
    const visible = ordered.slice(0, 12);
    container.innerHTML = visible.map(group => {
      const originalIndex = groups.indexOf(group);
      const color = clusterColors[originalIndex % clusterColors.length];
      return `
        <div class="dendrogram-cluster" style="--cluster-color:${color}">
          <span class="dendrogram-cluster__swatch" aria-hidden="true"></span>
          <strong>Grupo ${originalIndex + 1}</strong>
          <span>${group.size} ${group.size === 1 ? "obra" : "obras"} · ${escapeHtml(dominantSubject(group, records))}</span>
        </div>`;
    }).join("") + (ordered.length > visible.length
      ? `<p class="dendrogram-clusters__more">Mais ${ordered.length - visible.length} grupos aparecem identificados pelo código G no diagrama.</p>`
      : "");
  }

  function renderTree(model, k, elements) {
    const groups = cutTree(model.root, k);
    const assignments = new Uint16Array(model.records.length);
    groups.forEach((group, groupIndex) => group.leaves.forEach(index => { assignments[index] = groupIndex; }));
    const currentSilhouette = model.silhouetteByK.get(k) ?? silhouette(model.distance, groups);
    elements.cutValue.textContent = String(k);
    elements.status.textContent = `${k} grupos · silhouette ${currentSilhouette.toFixed(3)} · ${model.traceableCount} de ${model.records.length} obras com referências rastreáveis`;
    renderSummary(elements.summary, groups, model.records);

    const n = model.records.length;
    const rowGap = n > 160 ? 26 : n > 80 ? 30 : 40;
    const labelLines = n > 120 ? 1 : 2;
    const width = Math.max(1040, elements.chart.clientWidth || 1040);
    const height = Math.max(500, 100 + n * rowGap);
    const plotLeft = 66;
    const labelWidth = Math.min(420, Math.max(300, width * 0.34));
    const plotRight = width - labelWidth;
    const top = 72;
    const bottom = 28;
    const rootHeight = Math.max(model.root.height, 0.001);
    const x = heightValue => plotLeft + (1 - heightValue / rootHeight) * (plotRight - plotLeft);
    const leaves = [];
    const collectLeaves = node => {
      if (!node.left) leaves.push(node);
      else {
        collectLeaves(node.left);
        collectLeaves(node.right);
      }
    };
    collectLeaves(model.root);
    const yByIndex = new Map(leaves.map((leaf, index) => [leaf.index, top + index * rowGap]));
    const position = node => {
      if (!node.left) {
        node.x = x(0);
        node.y = yByIndex.get(node.index);
      } else {
        position(node.left);
        position(node.right);
        node.x = x(node.height);
        node.y = (node.left.y + node.right.y) / 2;
      }
    };
    position(model.root);

    const svg = elements.svg;
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("height", String(height));
    const title = svgElement("title");
    title.textContent = `Dendrograma de ${n} documentos em ${k} grupos`;
    svg.append(title);
    const description = svgElement("desc");
    description.textContent = "Ramos mais próximos da direita representam maior afinidade. As cores representam o corte atual em grupos.";
    svg.append(description);

    const frame = svgElement("rect", {
      x: plotLeft,
      y: 46,
      width: plotRight - plotLeft,
      height: height - 46 - bottom,
      class: "dendrogram-frame",
    });
    svg.append(frame);

    [0, 0.25, 0.5, 0.75, 1].forEach(fraction => {
      const distanceValue = rootHeight * fraction;
      const px = x(distanceValue);
      svg.append(svgElement("line", { x1: px, y1: 46, x2: px, y2: height - bottom, class: "dendrogram-grid" }));
      const label = svgElement("text", { x: px, y: 34, class: "dendrogram-axis", "text-anchor": "middle" });
      label.textContent = distanceValue.toFixed(2);
      svg.append(label);
    });
    const axisTitle = svgElement("text", {
      x: (plotLeft + plotRight) / 2,
      y: 16,
      class: "dendrogram-axis-title",
      "text-anchor": "middle",
    });
    axisTitle.textContent = "Distância composta — 0 indica maior afinidade";
    svg.append(axisTitle);

    const drawBranches = node => {
      if (!node.left) return;
      [node.left, node.right].forEach(child => {
        const cluster = nodeCluster(child, assignments);
        const path = svgElement("path", {
          d: `M${node.x},${node.y}H${child.x}V${child.y}`,
          class: "dendrogram-branch",
        });
        if (cluster !== null) path.style.setProperty("--branch-color", clusterColors[cluster % clusterColors.length]);
        svg.append(path);
        drawBranches(child);
      });
    };
    drawBranches(model.root);

    leaves.forEach(leaf => {
      const record = model.records[leaf.index];
      const cluster = assignments[leaf.index];
      const group = svgElement("g", {
        class: "dendrogram-leaf",
        role: "button",
        tabindex: "0",
        "data-dendrogram-node": record.id,
        "aria-label": `Abrir ficha de ${record.titulo}`,
      });
      group.style.setProperty("--leaf-color", clusterColors[cluster % clusterColors.length]);
      group.append(svgElement("circle", { cx: leaf.x, cy: leaf.y, r: 4, class: "dendrogram-leaf__dot" }));
      const groupCode = svgElement("text", { x: leaf.x + 11, y: leaf.y + 4, class: "dendrogram-leaf__group" });
      groupCode.textContent = `G${cluster + 1}`;
      const labelX = leaf.x + 43;
      const text = svgElement("text", { x: labelX, y: leaf.y + (labelLines === 1 ? 4 : -2), class: "dendrogram-leaf__label" });
      wrapTitle(record.titulo, n > 120 ? 58 : 48, labelLines).forEach((line, lineIndex) => {
        const tspan = svgElement("tspan", { x: labelX, dy: lineIndex ? "1.2em" : "0" });
        tspan.textContent = line;
        text.append(tspan);
      });
      const tooltip = svgElement("title");
      tooltip.textContent = `${record.titulo} · ${record.assunto || "Sem assunto"} · grupo ${cluster + 1}`;
      group.append(groupCode, text, tooltip);
      svg.append(group);
    });
  }

  function proximityForLeaves(leaves, distance) {
    if (leaves.length < 2) return 0;
    const nearest = leaves.map(index => Math.max(
      ...leaves
        .filter(other => other !== index)
        .map(other => 1 - distance[index][other])
    ));
    return nearest.reduce((sum, value) => sum + value, 0) / nearest.length;
  }

  function secondaryGroups(leaves, model) {
    if (leaves.length < 4) return [];
    const localDistance = leaves.map(first => {
      const row = new Float64Array(leaves.length);
      leaves.forEach((second, index) => { row[index] = model.distance[first][second]; });
      return row;
    });
    const localRoot = averageLinkage(localDistance);
    const k = Math.min(4, Math.max(2, Math.round(Math.sqrt(leaves.length))));
    return cutTree(localRoot, k).map(group => {
      const originalLeaves = group.leaves.map(index => leaves[index]);
      return {
        leaves: originalLeaves,
        proximity: proximityForLeaves(originalLeaves, model.distance),
      };
    });
  }

  function packCircles(items, maximumRadius, gap = 4) {
    if (!items.length) return [];
    const ordered = [...items]
      .map(item => ({ ...item, rawRadius: 7 + Math.sqrt(Math.max(1, item.weight)) * 8 }))
      .sort((a, b) => b.rawRadius - a.rawRadius);
    const placed = [];
    ordered.forEach((item, itemIndex) => {
      if (itemIndex === 0) {
        placed.push({ ...item, x: 0, y: 0 });
        return;
      }
      let candidate = null;
      for (let step = 1; step < 18000; step += 1) {
        const angle = step * 0.54;
        const radius = 2.45 * Math.sqrt(step);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const clear = placed.every(other =>
          Math.hypot(x - other.x, y - other.y) >= item.rawRadius + other.rawRadius + gap
        );
        if (clear) {
          candidate = { ...item, x, y };
          break;
        }
      }
      placed.push(candidate || { ...item, x: itemIndex * (item.rawRadius + gap), y: 0 });
    });
    const extent = Math.max(...placed.map(item => Math.hypot(item.x, item.y) + item.rawRadius), 1);
    const scale = maximumRadius / extent;
    return placed.map(item => ({
      ...item,
      x: item.x * scale,
      y: item.y * scale,
      radius: item.rawRadius * scale,
    }));
  }

  function pointPositions(leaves, centerX, centerY, radius) {
    if (leaves.length === 1) return [{ index: leaves[0], x: centerX, y: centerY }];
    return leaves.map((index, order) => {
      const fraction = Math.sqrt((order + 0.65) / leaves.length);
      const angle = order * 2.399963229728653;
      return {
        index,
        x: centerX + Math.cos(angle) * radius * fraction,
        y: centerY + Math.sin(angle) * radius * fraction,
      };
    });
  }

  function mapFocusMarkup(collection, model) {
    if (collection.unassigned) {
      return `
        <p class="eyebrow">Fora das coleções</p>
        <h4>Sem vínculo confiável</h4>
        <p>${collection.leaves.length} obras não ultrapassaram o limiar mínimo de ${Math.round(minimumSimilarity * 100)}%.</p>
        <button class="button button--quiet" type="button" data-cluster-unassigned>Ver no catálogo</button>`;
    }
    const representative = model.records[collection.representativeIndex];
    return `
      <p class="eyebrow">${escapeHtml(collection.code)} · ${escapeHtml(collection.level.label)}</p>
      <h4>${escapeHtml(collection.title)}</h4>
      <p><strong>${collection.leaves.length} obras</strong> · proximidade local ${Math.round(collection.proximity * 100)}%.</p>
      <dl>
        <dt>Obra representativa</dt>
        <dd><button type="button" data-cluster-open="${escapeHtml(representative.id)}">${escapeHtml(representative.titulo)}</button></dd>
        <dt>Base observada</dt>
        <dd>${escapeHtml(collection.evidence.join(" · "))}</dd>
      </dl>
      <div class="cluster-map__focus-actions">
        <button class="button" type="button" data-cluster-apply="${escapeHtml(collection.code)}">Ver no catálogo</button>
        <button class="button button--quiet" type="button" data-cluster-select="${escapeHtml(collection.code)}">Selecionar coleção</button>
      </div>`;
  }

  function renderClusterMap(model, analysis, elements) {
    const width = 1040;
    const height = 700;
    const centerX = width / 2;
    const centerY = height / 2 + 12;
    const outerRadius = 315;
    const collections = [
      ...analysis.collections,
      ...(analysis.unassigned.length ? [{
        code: "U",
        title: "Sem vínculo confiável",
        leaves: analysis.unassigned,
        unassigned: true,
      }] : []),
    ];
    const packed = packCircles(
      collections.map(collection => ({ key: collection.code, weight: collection.leaves.length, collection })),
      outerRadius - 18,
      5
    ).map(item => ({
      ...item,
      x: centerX + item.x,
      y: centerY + item.y,
    }));
    const bounds = new Map(packed.map(item => [item.key, item]));
    const svg = elements.svg;
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    const title = svgElement("title");
    title.textContent = `Mapa hierárquico de ${model.records.length} obras em ${analysis.collections.length} coleções`;
    const description = svgElement("desc");
    description.textContent = "Cada ponto representa uma obra. Contornos maiores representam coleções e contornos internos representam subdivisões mais coesas da hierarquia.";
    svg.append(title, description);
    svg.append(svgElement("circle", {
      cx: centerX,
      cy: centerY,
      r: outerRadius + 5,
      class: "cluster-map__universe",
    }));

    packed.forEach((item, collectionIndex) => {
      const { collection } = item;
      const group = svgElement("g", {
        class: `cluster-map__collection${collection.unassigned ? " cluster-map__collection--unassigned" : ""}`,
        role: "button",
        tabindex: "0",
        "data-cluster-map": collection.code,
        "aria-label": `${collection.title}, ${collection.leaves.length} obras. Selecionar e ampliar grupo.`,
      });
      group.style.setProperty("--cluster-color", clusterColors[collectionIndex % clusterColors.length]);
      const shape = svgElement("circle", {
        cx: item.x,
        cy: item.y,
        r: Math.max(7, item.radius),
        class: "cluster-map__collection-shape",
      });
      const tooltip = svgElement("title");
      tooltip.textContent = `${collection.code} · ${collection.title} · ${collection.leaves.length} obras${collection.proximity ? ` · proximidade ${Math.round(collection.proximity * 100)}%` : ""}`;
      group.append(shape, tooltip);

      const hasLabel = item.radius >= 40;
      const contentCenterY = item.y + (hasLabel ? item.radius * 0.15 : 0);
      const localRadius = Math.max(5, item.radius * (hasLabel ? 0.56 : 0.70));
      const secondary = collection.unassigned ? [] : secondaryGroups(collection.leaves, model);
      const meaningfulSecondary = secondary.length > 1 && secondary.some(subgroup =>
        subgroup.leaves.length > 1 && subgroup.proximity >= minimumSimilarity + 0.08
      );
      let positions = [];
      if (meaningfulSecondary) {
        const subPacked = packCircles(
          secondary.map((subgroup, index) => ({ key: index, weight: subgroup.leaves.length, subgroup })),
          localRadius,
          2
        );
        subPacked.forEach(subItem => {
          const subX = item.x + subItem.x;
          const subY = contentCenterY + subItem.y;
          const drawContour = subItem.subgroup.leaves.length > 1
            && subItem.subgroup.proximity >= minimumSimilarity + 0.08;
          if (drawContour) {
            group.append(svgElement("circle", {
              cx: subX,
              cy: subY,
              r: Math.max(4, subItem.radius),
              class: "cluster-map__subgroup",
            }));
          }
          positions.push(...pointPositions(
            subItem.subgroup.leaves,
            subX,
            subY,
            Math.max(1, subItem.radius * 0.62)
          ));
        });
      } else {
        positions = pointPositions(collection.leaves, item.x, contentCenterY, localRadius);
      }

      positions.forEach(position => {
        const record = model.records[position.index];
        const documentNode = svgElement("g", {
          class: "cluster-map__document",
          role: "button",
          tabindex: "0",
          "data-cluster-map-document": record.id,
          "aria-label": `Abrir ficha de ${record.titulo}`,
        });
        documentNode.append(
          svgElement("circle", { cx: position.x, cy: position.y, r: 8, class: "cluster-map__document-hit" }),
          svgElement("circle", { cx: position.x, cy: position.y, r: 3.2, class: "cluster-map__document-dot" })
        );
        const documentTitle = svgElement("title");
        documentTitle.textContent = `${record.titulo} · ${record.assunto || "Sem assunto"}`;
        documentNode.append(documentTitle);
        group.append(documentNode);
      });

      if (hasLabel) {
        const labelText = `${collection.code} · ${collection.leaves.length}`;
        const labelWidth = Math.min(Math.max(56, labelText.length * 6.2), item.radius * 1.55);
        const labelY = item.y - item.radius * 0.48;
        group.append(svgElement("rect", {
          x: item.x - labelWidth / 2,
          y: labelY - 13,
          width: labelWidth,
          height: 26,
          class: "cluster-map__label-box",
        }));
        const label = svgElement("text", {
          x: item.x,
          y: labelY + 4,
          class: "cluster-map__label",
          "text-anchor": "middle",
        });
        label.textContent = labelText;
        group.append(label);
      }
      svg.append(group);
    });

    const select = (code, zoom = true) => {
      const collection = collections.find(item => item.code === code);
      const bound = bounds.get(code);
      if (!collection || !bound) return;
      svg.querySelectorAll("[data-cluster-map]").forEach(group => {
        group.classList.toggle("cluster-map__collection--selected", group.dataset.clusterMap === code);
      });
      elements.choices?.querySelectorAll("[data-cluster-map-choice]").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.clusterMapChoice === code));
      });
      elements.focus.innerHTML = mapFocusMarkup(collection, model);
      if (zoom) {
        const margin = Math.max(16, bound.radius * 0.18);
        const size = (bound.radius + margin) * 2;
        svg.setAttribute("viewBox", `${bound.x - size / 2} ${bound.y - size / 2} ${size} ${size}`);
        elements.reset.hidden = false;
      }
    };
    const reset = () => {
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      elements.reset.hidden = true;
    };
    const initialCode = analysis.collections[0]?.code || (analysis.unassigned.length ? "U" : "");
    if (initialCode) select(initialCode, false);
    return { select, reset };
  }

  function mount(container, records, options = {}) {
    renderToken += 1;
    const token = renderToken;
    container.innerHTML = `
      <header class="dendrogram-header">
        <p class="eyebrow">Organização por afinidade</p>
        <h2>Coleções sugeridas</h2>
        <p>${escapeHtml(options.sourceLabel || "Filtro atual")} · ${records.length} ${records.length === 1 ? "documento" : "documentos"}</p>
      </header>
      <p class="dendrogram-loading" role="status" aria-live="polite">Analisando proximidades e formando coleções…</p>`;

    window.setTimeout(() => {
      if (token !== renderToken) return;
      try {
        const model = buildModel(records);
        const analysis = analyzeCollections(model, model.bestK);
        const groupedCount = analysis.collections.reduce((sum, collection) => sum + collection.leaves.length, 0);
        const coverage = Math.round(groupedCount / model.records.length * 100);
        const cards = analysis.collections.map((collection, index) =>
          collectionCard(collection, model, index >= initialCollectionLimit)
        ).join("");
        const mapChoices = analysis.collections.slice(0, initialCollectionLimit).map((collection, index) => `
          <button class="cluster-map__choice" type="button" data-cluster-map-choice="${escapeHtml(collection.code)}" aria-pressed="${index === 0}">
            <strong>${escapeHtml(collection.code)} · ${escapeHtml(collection.title)}</strong>
            <span>${collection.leaves.length} obras · ${Math.round(collection.proximity * 100)}% de proximidade local</span>
          </button>`).join("") + (analysis.unassigned.length ? `
          <button class="cluster-map__choice" type="button" data-cluster-map-choice="U" aria-pressed="${analysis.collections.length === 0}">
            <strong>U · Sem vínculo confiável</strong>
            <span>${analysis.unassigned.length} obras preservadas fora das coleções</span>
          </button>` : "");
        container.innerHTML = `
          <header class="dendrogram-header">
            <p class="eyebrow">Organização por afinidade</p>
            <h2>Coleções sugeridas</h2>
            <p>${escapeHtml(options.sourceLabel || "Filtro atual")} · ${model.records.length} documentos. O agrupamento hierárquico trabalha nos bastidores; aqui aparecem apenas relações com proximidade mínima de ${Math.round(minimumSimilarity * 100)}%.</p>
          </header>
          <section class="affinity-overview" aria-label="Resumo do agrupamento">
            <article><strong>${analysis.collections.length}</strong><span>Coleções úteis</span></article>
            <article><strong>${groupedCount}</strong><span>Obras agrupadas</span></article>
            <article><strong>${analysis.unassigned.length}</strong><span>Sem vínculo confiável</span></article>
            <article><strong>${coverage}%</strong><span>Cobertura das sugestões</span></article>
          </section>
          <div class="affinity-explainer">
            <div>
              <h3>Como interpretar</h3>
              <p><strong>Proximidade local</strong> resume o melhor vínculo de cada obra dentro da coleção. Ela combina título, assunto, subassunto, tags, autoria, publicação e, quando disponíveis, referências e citações locais.</p>
            </div>
            <p><strong>Importante:</strong> o percentual é um indicador comparativo desta biblioteca, não uma probabilidade nem prova de relação bibliográfica.</p>
          </div>
          <section class="cluster-map" aria-labelledby="cluster-map-title">
            <div class="cluster-map__heading">
              <div>
                <p class="eyebrow">Hierarquia navegável</p>
                <h3 id="cluster-map-title">Mapa das coleções</h3>
                <p>Pontos são obras; contornos representam coleções e subdivisões mais coesas. Selecione um contorno para ampliar.</p>
              </div>
              <button id="cluster-map-reset" class="button button--quiet" type="button" hidden>Ver mapa completo</button>
            </div>
            <div class="cluster-map__layout">
              <div id="cluster-map-chart" class="cluster-map__chart">
                <svg role="img" aria-labelledby="cluster-map-title"></svg>
              </div>
              <aside id="cluster-map-focus" class="cluster-map__focus" aria-live="polite"></aside>
            </div>
            <div id="cluster-map-choices" class="cluster-map__choices" aria-label="Selecionar uma coleção no mapa">${mapChoices}</div>
            <div class="cluster-map__legend" aria-label="Legenda do mapa">
              <span><i class="cluster-map__legend-dot" aria-hidden="true"></i> Obra</span>
              <span><i class="cluster-map__legend-contour" aria-hidden="true"></i> Coleção</span>
              <span><i class="cluster-map__legend-contour cluster-map__legend-contour--inner" aria-hidden="true"></i> Subgrupo com afinidade mais forte</span>
            </div>
          </section>
          <div class="affinity-collections__heading">
            <div><h3>Coleções encontradas</h3><p>Abra uma obra para conferir a ficha ou aplique a coleção como filtro no catálogo.</p></div>
            <button id="dendrograma-arvore-toggle" class="button button--quiet" type="button" aria-expanded="false">Ver árvore técnica</button>
          </div>
          ${analysis.collections.length
            ? `<div id="colecoes-sugeridas" class="affinity-collections">${cards}</div>`
            : `<div class="empty-state affinity-collections__empty"><h3>Nenhuma coleção ultrapassou o limiar.</h3><p>Os documentos continuam disponíveis individualmente e não foram forçados em grupos frágeis.</p></div>`}
          ${analysis.collections.length > initialCollectionLimit
            ? `<button id="mostrar-todas-colecoes" class="button button--quiet affinity-collections__more" type="button" aria-expanded="false">Mostrar todas as ${analysis.collections.length} coleções</button>`
            : ""}
          ${analysis.unassigned.length ? `
            <aside class="affinity-unassigned">
              <div><span class="affinity-unassigned__number">${analysis.unassigned.length}</span><div><h3>Sem agrupamento confiável</h3><p>Essas obras ficaram abaixo do limiar de ${Math.round(minimumSimilarity * 100)}% ou isoladas no corte sugerido.</p></div></div>
              <button class="button button--quiet" type="button" data-cluster-unassigned>Ver no catálogo</button>
            </aside>` : ""}
          <section id="dendrograma-tecnico" class="dendrogram-technical" hidden>
            <div class="dendrogram-technical__heading">
              <div><p class="eyebrow">Auditoria do agrupamento</p><h3>Árvore técnica</h3><p>Use esta visualização para inspecionar o corte, não como navegação principal.</p></div>
            </div>
            <div class="dendrogram-toolbar">
              <label for="dendrograma-corte">
                <span>Número de grupos</span>
                <input id="dendrograma-corte" type="range" min="2" max="${model.maximumK}" value="${model.bestK}">
                <output id="dendrograma-corte-valor">${model.bestK}</output>
              </label>
              <button id="dendrograma-corte-sugerido" class="button button--quiet" type="button">Usar corte sugerido (${model.bestK})</button>
            </div>
            <p id="dendrograma-status" class="dendrogram-status" role="status" aria-live="polite"></p>
            <div id="dendrograma-grupos" class="dendrogram-clusters" aria-label="Resumo dos grupos técnicos"></div>
            <div id="dendrograma-grafico" class="dendrogram-chart"><svg role="img" aria-labelledby="dendrograma-status"></svg></div>
            <p class="dendrogram-note"><strong>Leitura:</strong> uniões mais próximas de zero indicam maior afinidade. A árvore inclui o corte bruto; as coleções acima ainda aplicam o limiar mínimo para não forçar vínculos frágeis.</p>
          </section>`;
        const elements = {
          cut: container.querySelector("#dendrograma-corte"),
          cutValue: container.querySelector("#dendrograma-corte-valor"),
          suggested: container.querySelector("#dendrograma-corte-sugerido"),
          status: container.querySelector("#dendrograma-status"),
          summary: container.querySelector("#dendrograma-grupos"),
          chart: container.querySelector("#dendrograma-grafico"),
          svg: container.querySelector("#dendrograma-grafico svg"),
        };
        const mapElements = {
          chart: container.querySelector("#cluster-map-chart"),
          svg: container.querySelector("#cluster-map-chart svg"),
          focus: container.querySelector("#cluster-map-focus"),
          reset: container.querySelector("#cluster-map-reset"),
          choices: container.querySelector("#cluster-map-choices"),
        };
        const clusterMap = renderClusterMap(model, analysis, mapElements);
        mapElements.reset.addEventListener("click", clusterMap.reset);
        const update = () => renderTree(model, Number(elements.cut.value), elements);
        elements.cut.addEventListener("input", update);
        elements.suggested.addEventListener("click", () => {
          elements.cut.value = String(model.bestK);
          update();
        });
        const technical = container.querySelector("#dendrograma-tecnico");
        const technicalToggle = container.querySelector("#dendrograma-arvore-toggle");
        let technicalRendered = false;
        technicalToggle.addEventListener("click", () => {
          const willOpen = technical.hidden;
          technical.hidden = !willOpen;
          technicalToggle.setAttribute("aria-expanded", String(willOpen));
          technicalToggle.textContent = willOpen ? "Ocultar árvore técnica" : "Ver árvore técnica";
          if (willOpen && !technicalRendered) {
            technicalRendered = true;
            update();
          }
          if (willOpen) technical.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        const showAll = container.querySelector("#mostrar-todas-colecoes");
        showAll?.addEventListener("click", () => {
          const expanded = showAll.getAttribute("aria-expanded") === "true";
          container.querySelectorAll("[data-collection-secondary]").forEach(card => {
            card.classList.toggle("affinity-collection--hidden", expanded);
          });
          showAll.setAttribute("aria-expanded", String(!expanded));
          showAll.textContent = expanded ? `Mostrar todas as ${analysis.collections.length} coleções` : "Mostrar somente as prioritárias";
        });
        container.onclick = event => {
          const mapDocument = event.target.closest("[data-cluster-map-document]");
          if (mapDocument) {
            document.dispatchEvent(new CustomEvent("catalogo:open-details", { detail: { id: mapDocument.dataset.clusterMapDocument } }));
            return;
          }
          const mapCollection = event.target.closest("[data-cluster-map]");
          if (mapCollection) {
            clusterMap.select(mapCollection.dataset.clusterMap);
            return;
          }
          const mapChoice = event.target.closest("[data-cluster-map-choice]");
          if (mapChoice) {
            clusterMap.select(mapChoice.dataset.clusterMapChoice);
            return;
          }
          const open = event.target.closest("[data-cluster-open]");
          if (open) {
            document.dispatchEvent(new CustomEvent("catalogo:open-details", { detail: { id: open.dataset.clusterOpen } }));
            return;
          }
          const apply = event.target.closest("[data-cluster-apply]");
          if (apply) {
            const collection = analysis.collections.find(item => item.code === apply.dataset.clusterApply);
            if (!collection) return;
            document.dispatchEvent(new CustomEvent("catalogo:apply-cluster", {
              detail: {
                ids: collection.leaves.map(index => model.records[index].id),
                label: `${collection.code} · ${collection.title}`,
              },
            }));
            return;
          }
          const select = event.target.closest("[data-cluster-select]");
          if (select) {
            const collection = analysis.collections.find(item => item.code === select.dataset.clusterSelect);
            if (!collection) return;
            document.dispatchEvent(new CustomEvent("catalogo:select-cluster", {
              detail: {
                ids: collection.leaves.map(index => model.records[index].id),
                label: `${collection.code} · ${collection.title}`,
              },
            }));
            return;
          }
          if (event.target.closest("[data-cluster-unassigned]")) {
            document.dispatchEvent(new CustomEvent("catalogo:apply-cluster", {
              detail: {
                ids: analysis.unassigned.map(index => model.records[index].id),
                label: "Sem agrupamento confiável",
              },
            }));
          }
        };
        elements.svg.addEventListener("click", event => {
          const node = event.target.closest("[data-dendrogram-node]");
          if (node) document.dispatchEvent(new CustomEvent("catalogo:open-details", { detail: { id: node.dataset.dendrogramNode } }));
        });
        elements.svg.addEventListener("keydown", event => {
          const node = event.target.closest("[data-dendrogram-node]");
          if (node && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            document.dispatchEvent(new CustomEvent("catalogo:open-details", { detail: { id: node.dataset.dendrogramNode } }));
          }
        });
        mapElements.svg.addEventListener("keydown", event => {
          const documentNode = event.target.closest("[data-cluster-map-document]");
          if (documentNode && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            document.dispatchEvent(new CustomEvent("catalogo:open-details", { detail: { id: documentNode.dataset.clusterMapDocument } }));
            return;
          }
          const collectionNode = event.target.closest("[data-cluster-map]");
          if (collectionNode && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            clusterMap.select(collectionNode.dataset.clusterMap);
          }
        });
      } catch (error) {
        container.innerHTML = `
          <header class="dendrogram-header"><p class="eyebrow">Organização por afinidade</p><h2>Coleções sugeridas</h2></header>
          <div class="empty-state"><h3>Não foi possível calcular os agrupamentos.</h3><p>${escapeHtml(error.message)}</p></div>`;
      }
    }, 0);
  }

  window.DendrogramaAfinidade = {
    available: catalogo.length > 1,
    mount,
    inspect(records = catalogo) {
      const model = buildModel(records);
      const analysis = analyzeCollections(model, model.bestK);
      return {
        documents: model.records.length,
        suggestedCut: model.bestK,
        silhouette: model.bestSilhouette,
        traceable: model.traceableCount,
        collections: analysis.collections.map(collection => ({
          code: collection.code,
          title: collection.title,
          proximity: collection.proximity,
          ids: collection.leaves.map(index => model.records[index].id),
          representative: model.records[collection.representativeIndex].id,
        })),
        unassigned: analysis.unassigned.map(index => model.records[index].id),
      };
    },
    context(id) {
      return buildContextIndex().get(id) || null;
    },
  };
})();
