(() => {
  "use strict";

  const registry = window.REDES_CITACOES || {};
  const catalog = new Map((window.CATALOGO || []).map(record => [record.id, record]));
  const nodes = new Map();

  function datasetLabel(data) {
    if (typeof data.scope === "string") return data.scope === "artigos" ? "Artigos" : data.scope;
    const scope = data.scope || {};
    const type = scope.sourceType === "artigo" ? "Artigos" : scope.sourceType === "livro" ? "Livros" : scope.sourceType;
    const publication = scope.sourcePublication
      ? scope.sourceType
        ? `Publicação: ${scope.sourcePublication}`
        : `Publicações ${scope.sourcePublication}`
      : "";
    return [type, scope.sourceSubject, publication].filter(Boolean).join(" · ") || "Toda a base";
  }

  function catalogNode(record) {
    return {
      id: record.id,
      title: record.titulo || "",
      authors: record.autores || [],
      subject: record.assunto || "",
      subsubject: record.subassunto || "",
      type: record.tipo || "",
      publication: record.publicacao || "",
};
  }

  const datasets = Object.entries(registry).map(([key, data]) => {
    const label = datasetLabel(data);
    const nodeIds = new Set();
    const sourceIds = new Set();
    const extraction = new Map();
    const outgoing = new Map();
    const incoming = new Map();
    const edgeMap = new Map();

    (data.nodes || []).forEach(node => {
      nodes.set(node.id, node);
      nodeIds.add(node.id);
    });
    (data.extraction || []).forEach(item => {
      const record = catalog.get(item.id);
      if (!nodes.has(item.id) && record) nodes.set(item.id, catalogNode(record));
      nodeIds.add(item.id);
      sourceIds.add(item.id);
      extraction.set(item.id, item);
    });
    (data.edges || []).forEach(edge => {
      const edgeKey = `${edge.source}|${edge.target}`;
      const previous = edgeMap.get(edgeKey);
      if (!previous || edge.confidence > previous.confidence) edgeMap.set(edgeKey, edge);
      [edge.source, edge.target].forEach(id => {
        const record = catalog.get(id);
        if (!nodes.has(id) && record) nodes.set(id, catalogNode(record));
        nodeIds.add(id);
      });
    });

    [...edgeMap.values()].forEach(edge => {
      if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
      if (!incoming.has(edge.target)) incoming.set(edge.target, []);
      outgoing.get(edge.source).push(edge);
      incoming.get(edge.target).push(edge);
    });

    return { key, label, nodeIds, sourceIds, extraction, outgoing, incoming };
  });

  function datasetsFor(id) {
    return datasets.filter(data => data.sourceIds.has(id) || data.nodeIds.has(id));
  }

  function mergedEdges(id) {
    const edges = new Map();
    datasetsFor(id).forEach(data => {
      [...(data.outgoing.get(id) || []), ...(data.incoming.get(id) || [])].forEach(edge => {
        const key = `${edge.source}|${edge.target}`;
        const previous = edges.get(key);
        if (!previous || edge.confidence > previous.confidence) edges.set(key, edge);
      });
    });
    return [...edges.values()];
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function truncate(value, length = 34) {
    const text = String(value || "");
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function methodLabel(method) {
    const labels = {
      doi_exato: "DOI exato",
      arxiv_exato: "arXiv exato",
      isbn_exato: "ISBN exato",
      titulo_autor_ano: "título + autoria + ano",
      titulo_autor: "título + autoria",
      titulo_ano: "título + ano",
      titulo_exato_longo: "título longo exato",
    };
    return labels[method] || String(method || "método não informado").replaceAll("_", " ");
  }

  function wrapLines(value, maxChars, maxLines) {
    const words = String(value || "").trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    words.forEach(word => {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxChars || !current) current = next;
      else {
        lines.push(current);
        current = word;
      }
    });
    if (current) lines.push(current);
    if (lines.length <= maxLines) return lines.map(line => truncate(line, maxChars + 1));
    const visible = lines.slice(0, maxLines - 1);
    visible.push(truncate(lines.slice(maxLines - 1).join(" "), maxChars));
    return visible;
  }

  function summary(id) {
    const links = connections(id);
    const attempts = datasetsFor(id)
      .map(data => data.extraction.get(id))
      .filter(Boolean);
    const referenceCounts = attempts
      .map(item => item.estimatedReferences)
      .filter(Number.isInteger);
    const bibliographyState = attempts.some(item => item.status === "ok")
      ? "detected"
      : attempts.some(item => item.status === "falha_leitura")
        ? "unreadable"
        : attempts.length
          ? "not_found"
          : "not_checked";
    return {
      cited: links.filter(link => link.kind === "outgoing" || link.kind === "both").length,
      citedBy: links.filter(link => link.kind === "incoming" || link.kind === "both").length,
      total: links.length,
      referencesFound: referenceCounts.length ? Math.max(...referenceCounts) : null,
      bibliographyState,
    };
  }

  function includes(id) {
    return datasetsFor(id).length > 0;
  }

  function scopeLabel(id) {
    const available = datasetsFor(id);
    if (!available.length) return "";
    return available.length === 1 ? available[0].label : "toda a base local";
  }

  function connections(id, direction = "both") {
    const links = new Map();
    const edges = mergedEdges(id);
    const add = (edge, neighborId, kind) => {
      const previous = links.get(neighborId);
      if (!previous) {
        links.set(neighborId, { edge, neighborId, kind });
      } else if (previous.kind !== kind) {
        previous.kind = "both";
        if (edge.confidence > previous.edge.confidence) previous.edge = edge;
      }
    };
    if (direction !== "incoming") {
      edges
        .filter(edge => edge.source === id)
        .forEach(edge => add(edge, edge.target, "outgoing"));
    }
    if (direction !== "outgoing") {
      edges
        .filter(edge => edge.target === id)
        .forEach(edge => add(edge, edge.source, "incoming"));
    }
    return [...links.values()]
      .filter(link => nodes.has(link.neighborId))
      .sort((a, b) => b.edge.confidence - a.edge.confidence ||
        nodes.get(a.neighborId).title.localeCompare(nodes.get(b.neighborId).title, "pt-BR"));
  }

  function nodeLayout(node, center = false) {
    const width = center ? 240 : 180;
    const titleLines = wrapLines(node.title, center ? 32 : 23, 3);
    const lineHeight = 14;
    const height = Math.max(center ? 82 : 76, titleLines.length * lineHeight + 42);
    return { width, height, titleLines, lineHeight };
  }

  function nodeLabel(node, x, y, center = false, kind = "") {
    const layout = nodeLayout(node, center);
    const relation = center
      ? "FONTE CENTRAL"
      : kind === "outgoing"
        ? "REFERÊNCIA CITADA"
        : kind === "incoming"
          ? "CITA ESTA FONTE"
          : "CITAÇÃO MÚTUA";
    const relationY = -layout.height / 2 + 17;
    const titleY = relationY + 20;
    const title = layout.titleLines.map((line, index) =>
      `<tspan x="0" y="${titleY + index * layout.lineHeight}">${escapeHtml(line)}</tspan>`
    ).join("");
    return `
      <g class="network-node network-node--${center ? "center" : kind}" data-network-node="${escapeHtml(node.id)}"
         role="button" tabindex="0" transform="translate(${x} ${y})" aria-label="Centralizar em ${escapeHtml(node.title)}">
        <rect x="${-layout.width / 2}" y="${-layout.height / 2}" width="${layout.width}" height="${layout.height}" rx="5"></rect>
        <text class="network-node__relation" text-anchor="middle" y="${relationY}">${relation}</text>
        <text class="network-node__title" text-anchor="middle">${title}</text>
      </g>`;
  }

  function clippedLine(x1, y1, x2, y2, fromBox, toBox) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const boundary = box => Math.min(
      Math.abs(ux) > 0.001 ? box.width / 2 / Math.abs(ux) : Infinity,
      Math.abs(uy) > 0.001 ? box.height / 2 / Math.abs(uy) : Infinity
    );
    const start = boundary(fromBox) + 5;
    const end = boundary(toBox) + 13;
    return {
      x1: x1 + ux * start,
      y1: y1 + uy * start,
      x2: x2 - ux * end,
      y2: y2 - uy * end,
      labelX: x1 + dx * 0.52,
      labelY: y1 + dy * 0.52 - 6,
    };
  }

  function render(id, direction = "both") {
    const center = nodes.get(id);
    if (!center) {
      return `<div class="network-empty"><h2>Rede bibliográfica</h2><p>Este documento não possui conexões internas confirmadas.</p></div>`;
    }

    const allLinks = connections(id, direction);
    const links = allLinks.slice(0, 12);
    const width = 920;
    const height = 560;
    const cx = width / 2;
    const cy = height / 2;
    const radiusX = links.length > 8 ? 350 : 300;
    const radiusY = links.length > 8 ? 215 : 190;
    const positions = links.map((link, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(links.length, 1);
      return {
        ...link,
        x: cx + Math.cos(angle) * radiusX,
        y: cy + Math.sin(angle) * radiusY,
      };
    });
    const counts = summary(id);
    const omitted = allLinks.length - links.length;
    const centerBox = nodeLayout(center, true);
    const edgeSvg = positions.map(link => {
      const neighbor = nodes.get(link.neighborId);
      const neighborBox = nodeLayout(neighbor);
      const pointsFromCenter = link.kind !== "incoming";
      const startX = pointsFromCenter ? cx : link.x;
      const startY = pointsFromCenter ? cy : link.y;
      const endX = pointsFromCenter ? link.x : cx;
      const endY = pointsFromCenter ? link.y : cy;
      const fromBox = pointsFromCenter ? centerBox : neighborBox;
      const toBox = pointsFromCenter ? neighborBox : centerBox;
      const line = clippedLine(startX, startY, endX, endY, fromBox, toBox);
      const marker = link.kind === "outgoing" ? "network-arrow-out" : link.kind === "incoming" ? "network-arrow-in" : "network-arrow-both";
      const markerStart = link.kind === "both" ? ` marker-start="url(#${marker})"` : "";
      const edgeLabel = link.kind === "both" ? "CITAM-SE" : "CITA";
      return `<g class="network-relation network-relation--${link.kind}">
        <line class="network-edge network-edge--${link.kind}" x1="${line.x1}" y1="${line.y1}"
          x2="${line.x2}" y2="${line.y2}"${markerStart} marker-end="url(#${marker})"></line>
        <text class="network-edge-label" x="${line.labelX}" y="${line.labelY}" text-anchor="middle">${edgeLabel}</text>
      </g>`;
    }).join("");
    const nodeSvg = positions.map(link => nodeLabel(nodes.get(link.neighborId), link.x, link.y, false, link.kind)).join("");
    const list = allLinks.map(link => {
      const neighbor = nodes.get(link.neighborId);
      const label = link.kind === "outgoing" ? "Central cita" : link.kind === "incoming" ? "Cita a central" : "Citação mútua";
      const evidenceSource = nodes.get(link.edge.source) || catalog.get(link.edge.source);
      const page = Number(link.edge.page) || null;
      return `
        <article class="network-list__item">
          <button type="button" class="network-list__main" data-network-node="${escapeHtml(neighbor.id)}">
            <span class="network-list__direction network-list__direction--${link.kind}">${label}</span>
            <strong>${escapeHtml(neighbor.title)}</strong>
            <small>${escapeHtml(neighbor.subject)} · ${Math.round(link.edge.confidence * 100)}% · ${escapeHtml(methodLabel(link.edge.method))}</small>
          </button>
          <details class="relation-evidence">
            <summary>Ver evidência${page ? ` · p. ${page}` : ""}</summary>
            <p><strong>Encontrada em:</strong> ${escapeHtml(evidenceSource?.title || "PDF citante")}${page ? `, página ${page}` : ""}</p>
            <blockquote>${escapeHtml(link.edge.evidence || "Trecho não disponível.")}</blockquote>
          </details>
        </article>`;
    }).join("");

    return `
      <header class="network-header">
        <div>
          <p class="eyebrow">Rede bibliográfica local · ${escapeHtml(scopeLabel(id))}</p>
          <h2>${escapeHtml(center.title)}</h2>
          ${Number.isInteger(counts.referencesFound) ? `<p>${counts.referencesFound} referências identificadas na bibliografia do PDF.</p>` : ""}
          ${counts.bibliographyState === "not_found" ? `<p>Nenhuma seção bibliográfica formal foi detectada neste PDF legível. Citações recebidas por outras obras continuam sendo exibidas.</p>` : ""}
          ${counts.bibliographyState === "unreadable" ? `<p>O PDF não pôde ser lido; por isso suas referências internas não foram examinadas. Citações recebidas por outras obras continuam sendo exibidas.</p>` : ""}
          <p>${counts.cited} ${counts.cited === 1 ? "obra local citada" : "obras locais citadas"} ·
             ${counts.citedBy} ${counts.citedBy === 1 ? "obra local cita" : "obras locais citam"} esta fonte</p>
        </div>
        <button type="button" class="button button--quiet" data-network-detail="${escapeHtml(id)}">Ver ficha</button>
      </header>
      <nav class="relation-tabs" aria-label="Tipo de relação">
        <button type="button" data-open-network="${escapeHtml(id)}" aria-pressed="true">Citações locais diretas</button>
        <button type="button" data-open-affinity="${escapeHtml(id)}" aria-pressed="false">Referências compartilhadas</button>
      </nav>
      <div class="network-controls" role="group" aria-label="Direção das conexões">
        <button type="button" data-network-direction="both" aria-pressed="${direction === "both"}">Todas</button>
        <button type="button" data-network-direction="outgoing" aria-pressed="${direction === "outgoing"}">O que esta fonte cita</button>
        <button type="button" data-network-direction="incoming" aria-pressed="${direction === "incoming"}">Quem cita esta fonte</button>
      </div>
      ${links.length ? `
        <div class="network-canvas" aria-label="Teia de conexões bibliográficas">
          <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="network-svg-title">
            <title id="network-svg-title">Conexões bibliográficas de ${escapeHtml(center.title)}</title>
            <defs>
              <marker id="network-arrow-out" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
              <marker id="network-arrow-in" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
              <marker id="network-arrow-both" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
            </defs>
            ${edgeSvg}
            ${nodeSvg}
            ${nodeLabel(center, cx, cy, true)}
          </svg>
          ${omitted > 0 ? `<p class="network-note">A teia mostra 12 de ${allLinks.length} conexões para manter os títulos legíveis; a lista abaixo mostra todas.</p>` : ""}
        </div>` : `<div class="network-empty"><p>Nenhuma conexão nesta direção.</p></div>`}
      <div class="network-legend"><span><i class="network-legend__out"></i><strong>Dourado:</strong> a fonte central cita o documento</span><span><i class="network-legend__in"></i><strong>Azul:</strong> o documento cita a fonte central</span><span><i class="network-legend__both"></i><strong>Verde:</strong> citação nos dois sentidos</span></div>
      <p class="network-method-note">Cada ligação inclui o método de identificação, a confiança e o trecho localizado no PDF citante. “Não detectado” nunca é interpretado como ausência de citação.</p>
      <div class="network-list" aria-label="Lista de conexões">${list}</div>`;
  }

  window.RedeCitacoes = { includes, summary, render, scopeLabel };
})();
