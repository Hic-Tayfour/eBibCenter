(() => {
  "use strict";

  const data = window.MAPA_AFINIDADE || {};
  const nodes = new Map((data.nodes || []).map(node => [node.id, node]));
  const catalog = new Map((window.CATALOGO || []).map(record => [record.id, {
    id: record.id,
    title: record.titulo || "",
    authors: record.autores || [],
    subject: record.assunto || "",
    subsubject: record.subassunto || "",
    type: record.tipo || "",
    publication: record.publicacao || "",
year: "",
  }]));
  const extraction = new Map((data.extraction || []).map(item => [item.id, item]));
  const adjacency = new Map();
  const edgeByPair = new Map();

  function pairKey(left, right) {
    return [left, right].sort().join("|");
  }

  (data.edges || []).forEach(edge => {
    edgeByPair.set(pairKey(edge.source, edge.target), edge);
    [
      [edge.source, edge.target],
      [edge.target, edge.source],
    ].forEach(([source, target]) => {
      if (!adjacency.has(source)) adjacency.set(source, []);
      adjacency.get(source).push({ ...edge, neighborId: target });
    });
  });
  adjacency.forEach(edges => edges.sort((left, right) =>
    right.similarity - left.similarity ||
    right.sharedReferences - left.sharedReferences ||
    (nodes.get(left.neighborId)?.title || "").localeCompare(nodes.get(right.neighborId)?.title || "", "pt-BR")
  ));

  const years = [...nodes.values()].map(node => Number(node.year)).filter(Number.isFinite);
  const minYear = years.length ? Math.min(...years) : 1900;
  const maxYear = years.length ? Math.max(...years) : 2026;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function wrapLines(value, maxChars = 24, maxLines = 3) {
    const words = String(value || "").trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    words.forEach(word => {
      const next = current ? `${current} ${word}` : word;
      if (!current || next.length <= maxChars) current = next;
      else {
        lines.push(current);
        current = word;
      }
    });
    if (current) lines.push(current);
    if (lines.length <= maxLines) return lines;
    const visible = lines.slice(0, maxLines);
    visible[maxLines - 1] = `${visible[maxLines - 1].slice(0, maxChars - 1)}…`;
    return visible;
  }

  function nodeColor(year) {
    const value = Number(year);
    if (!Number.isFinite(value)) return "#7b817c";
    const ratio = Math.max(0, Math.min(1, (value - minYear) / Math.max(1, maxYear - minYear)));
    const hue = 42 + ratio * 112;
    return `hsl(${hue} 54% 36%)`;
  }

  function related(id) {
    return adjacency.get(id) || [];
  }

  function includes(id) {
    return extraction.has(id);
  }

  function unavailableMessage(item) {
    if (!item) return "Esta obra ainda não foi analisada para afinidade bibliográfica.";
    if (item.status === "falha_leitura") {
      return "O PDF não pôde ser lido; a afinidade bibliográfica não foi examinada.";
    }
    if (item.status === "bibliografia_nao_localizada" || (!item.heading && !item.parsedReferences)) {
      return "Sem seção bibliográfica formal detectada no PDF; a afinidade por referências compartilhadas não pode ser calculada.";
    }
    return "A bibliografia foi localizada, mas contém menos de duas referências extraíveis para calcular a afinidade com segurança.";
  }

  function summary(id) {
    const item = extraction.get(id);
    const links = related(id);
    const traceable = item?.status === "rastreavel" && nodes.has(id);
    return {
      available: Boolean(item),
      traceable,
      status: item?.status || "nao_analisado",
      message: traceable ? "" : unavailableMessage(item),
      references: item?.parsedReferences ?? null,
      related: links.length,
      strongest: links[0]?.similarity ?? 0,
    };
  }

  function positionLinks(id, limit = 18) {
    const links = related(id).slice(0, limit);
    const innerCount = Math.min(7, links.length);
    return links.map((link, index) => {
      const inner = index < innerCount;
      const ringIndex = inner ? index : index - innerCount;
      const ringCount = inner ? innerCount : links.length - innerCount;
      const angle = -Math.PI / 2 + (Math.PI * 2 * ringIndex) / Math.max(1, ringCount);
      return {
        ...link,
        x: 500 + Math.cos(angle) * (inner ? 245 : 410),
        y: 310 + Math.sin(angle) * (inner ? 170 : 250),
      };
    });
  }

  function nodeMarkup(node, x, y, center = false) {
    const degree = related(node.id).length;
    const radius = center ? 22 : Math.min(19, 8 + Math.sqrt(degree) * 1.8);
    const lines = wrapLines(node.title, center ? 28 : 22, center ? 3 : 2);
    const startY = radius + 17;
    const title = lines.map((line, index) =>
      `<tspan x="0" y="${startY + index * 13}">${escapeHtml(line)}</tspan>`
    ).join("");
    return `
      <g class="affinity-node${center ? " affinity-node--center" : ""}" data-affinity-node="${escapeHtml(node.id)}"
         role="button" tabindex="0" transform="translate(${x} ${y})" aria-label="Centralizar em ${escapeHtml(node.title)}">
        <circle r="${radius}" fill="${nodeColor(node.year)}"></circle>
        <text class="affinity-node__year" text-anchor="middle" y="4">${escapeHtml(node.year || "s.d.")}</text>
        <text class="affinity-node__title" text-anchor="middle">${title}</text>
      </g>`;
  }

  function render(id) {
    const center = nodes.get(id) || catalog.get(id);
    const info = summary(id);
    if (!center) {
      return `<div class="network-empty"><h2>Mapa de afinidade bibliográfica</h2><p>Esta obra não foi encontrada no catálogo.</p></div>`;
    }
    if (!info.traceable) {
      return `
        <header class="network-header">
          <div>
            <p class="eyebrow">Mapa de afinidade bibliográfica local</p>
            <h2>${escapeHtml(center.title)}</h2>
          </div>
          <button type="button" class="button button--quiet" data-network-detail="${escapeHtml(id)}">Ver ficha</button>
        </header>
        <nav class="relation-tabs" aria-label="Tipo de relação">
          <button type="button" data-open-network="${escapeHtml(id)}" aria-pressed="false">Citações locais diretas</button>
          <button type="button" data-open-affinity="${escapeHtml(id)}" aria-pressed="true">Referências compartilhadas</button>
        </nav>
        <div class="network-empty"><p>${escapeHtml(info.message)}</p></div>`;
    }

    const links = related(id);
    const visible = positionLinks(id);
    const visibleIds = new Set([id, ...visible.map(link => link.neighborId)]);
    const positions = new Map([[id, { x: 500, y: 310 }], ...visible.map(link => [link.neighborId, link])]);
    const visibleEdges = [...edgeByPair.values()].filter(edge =>
      visibleIds.has(edge.source) && visibleIds.has(edge.target)
    );
    const edges = visibleEdges.map(edge => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      const central = edge.source === id || edge.target === id;
      const width = Math.min(7, 0.8 + edge.sharedReferences * 0.16 + edge.similarity * 4);
      return `<line class="affinity-edge${central ? " affinity-edge--central" : ""}"
        x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}"
        style="stroke-width:${width.toFixed(2)}">
        <title>${edge.sharedReferences} referências compartilhadas · ${(edge.similarity * 100).toFixed(1)}% de afinidade</title>
      </line>`;
    }).join("");
    const nodeSvg = visible.map(link => nodeMarkup(nodes.get(link.neighborId), link.x, link.y)).join("");
    const list = links.map(link => {
      const neighbor = nodes.get(link.neighborId);
      const evidence = (link.evidence || []).map((item, index) => {
        const centerPage = Number(item.pages?.[id]) || null;
        const neighborPage = Number(item.pages?.[link.neighborId]) || null;
        const confidence = Number(item.confidence);
        return `
          <li>
            <p><strong>Referência compartilhada ${index + 1}</strong> · ${escapeHtml(item.method || "correspondência textual")}${Number.isFinite(confidence) ? ` · ${(confidence * 100).toFixed(0)}%` : ""}</p>
            <blockquote>${escapeHtml(item.reference || "Trecho não disponível.")}</blockquote>
            <div class="relation-evidence__actions">
            </div>
          </li>`;
      }).join("");
      return `
        <article class="affinity-list__item">
          <button type="button" class="affinity-list__main" data-affinity-node="${escapeHtml(neighbor.id)}">
            <span class="affinity-list__score">${(link.similarity * 100).toFixed(1)}%</span>
            <strong>${escapeHtml(neighbor.title)}</strong>
            <small>${link.sharedReferences} referências em comum · ${escapeHtml(neighbor.year || "ano não identificado")} · ${escapeHtml(neighbor.publication || neighbor.subject)}</small>
          </button>
          <details class="relation-evidence">
            <summary>Ver referências compartilhadas</summary>
            <ol>${evidence || "<li>Trechos de evidência indisponíveis.</li>"}</ol>
          </details>
        </article>`;
    }).join("");
    return `
      <header class="network-header">
        <div>
          <p class="eyebrow">Mapa de afinidade bibliográfica local</p>
          <h2>${escapeHtml(center.title)}</h2>
          <p>${info.references ?? 0} referências rastreadas · ${info.related} ${info.related === 1 ? "obra relacionada" : "obras relacionadas"}</p>
        </div>
        <button type="button" class="button button--quiet" data-network-detail="${escapeHtml(id)}">Ver ficha</button>
      </header>
      <nav class="relation-tabs" aria-label="Tipo de relação">
        <button type="button" data-open-network="${escapeHtml(id)}" aria-pressed="false">Citações locais diretas</button>
        <button type="button" data-open-affinity="${escapeHtml(id)}" aria-pressed="true">Referências compartilhadas</button>
      </nav>
      <div class="affinity-explainer">
        <strong>Como ler:</strong> linhas mais espessas indicam maior sobreposição bibliográfica. O tamanho do nó representa quantas conexões locais ele possui; a cor representa o ano de publicação.
      </div>
      ${visible.length ? `
        <div class="network-canvas affinity-canvas" aria-label="Mapa de obras com referências compartilhadas">
          <svg viewBox="0 0 1000 640" role="img" aria-labelledby="affinity-svg-title">
            <title id="affinity-svg-title">Obras bibliograficamente próximas de ${escapeHtml(center.title)}</title>
            ${edges}
            ${nodeSvg}
            ${nodeMarkup(center, 500, 310, true)}
          </svg>
          ${links.length > visible.length ? `<p class="network-note">O mapa mostra as ${visible.length} relações mais fortes de ${links.length}; a lista abaixo mostra todas.</p>` : ""}
        </div>` : `<div class="network-empty"><p>A bibliografia foi rastreada, mas nenhuma outra obra compartilha pelo menos duas referências confirmadas.</p></div>`}
      <div class="affinity-legend">
        <span class="affinity-legend__year">mais antiga <i></i> mais recente</span>
        <span><b class="affinity-legend__thin"></b> menor proximidade</span>
        <span><b class="affinity-legend__thick"></b> maior proximidade</span>
      </div>
      <p class="network-method-note">A afinidade é calculada apenas com referências efetivamente extraídas dos PDFs locais. Abra cada evidência para conferir os trechos e as páginas de origem.</p>
      <div class="affinity-list" aria-label="Obras relacionadas">${list}</div>`;
  }

  window.MapaAfinidade = { includes, summary, render };
})();
