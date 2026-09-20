(() => {
  "use strict";

  const app = document.querySelector("#app");
  const onlineMode = window.MEU_ACERVO_ONLINE === true;
  const docs = Array.isArray(window.CATALOGO) ? window.CATALOGO : [];
  const meta = window.CATALOGO_META || {};
  const textMeta = window.CATALOGO_INDICE_META || null;
  const citationData = window.REDES_CITACOES?.global || { nodes: [], edges: [], extraction: [] };
  const affinityData = window.MAPA_AFINIDADE || { nodes: [], edges: [], extraction: [] };
  const docsById = new Map(docs.map(doc => [doc.id, doc]));
  const citationExtraction = new Map((citationData.extraction || []).map(item => [item.id, item]));
  const affinityExtraction = new Map((affinityData.extraction || []).map(item => [item.id, item]));
  const loadedScripts = new Map();

  const preferred = docs.find(doc => normalize(doc.titulo) === "probability measure theory")
    || docs.find(doc => /probability.*measure theory/i.test(doc.titulo || ""))
    || docs[0];

  const state = {
    view: "catalog",
    searchMode: "metadata",
    query: "",
    filters: {
      type: "",
      subject: "",
      subsubject: "",
      year: "",
      summary: "",
      online: "",
      quality: "",
    },
    collectionOnly: "",
    sort: "title",
    layout: "list",
    limit: 60,
    selectedId: preferred?.id || "",
    previewOpen: false,
    detailTab: "toc",
    qualityIssue: "all",
    textResults: [],
    textStatus: "Digite uma expressão para pesquisar dentro dos PDFs indexados.",
    textLoading: false,
    networkId: preferred?.id || "",
    networkTargetId: "",
    networkFilters: {
      outgoing: true,
      incoming: true,
      shared: true,
      affinity: true,
    },
    menuOpen: false,
    toast: "",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function truncate(value, length = 90) {
    const text = String(value || "").trim();
    return text.length > length ? `${text.slice(0, length - 1).trim()}…` : text;
  }

  function icon(name) {
    const paths = {
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
      arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
      chevron: '<path d="m9 6 6 6-6 6"/>',
      catalog: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22V5.5ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22V5.5Z"/>',
      collection: '<path d="M4 5h16v14H4zM8 5V3h8v2M8 9h8M8 13h8"/>',
      quality: '<path d="M12 3 4.5 6v5.4c0 4.7 3.2 8.1 7.5 9.6 4.3-1.5 7.5-4.9 7.5-9.6V6L12 3Z"/><path d="m9 12 2 2 4-5"/>',
      relations: '<circle cx="5" cy="12" r="2.5"/><circle cx="18" cy="5" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m7.2 10.8 8.5-4.6M7.2 13.2l8.5 4.6"/>',
      document: '<path d="M6 2.5h8l4 4V21H6z"/><path d="M14 2.5v5h4M9 12h6M9 16h6"/>',
      text: '<path d="M5 4h14M9 8h6M9 12h6M9 16h6M5 8h.01M5 12h.01M5 16h.01"/>',
      filter: '<path d="M4 5h16l-6.5 7v6l-3 1.5V12L4 5Z"/>',
      list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
      grid: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>',
      menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21c.6-4 3.1-6 7-6s6.4 2 7 6"/>',
      monitor: '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8M12 17v4"/>',
      globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
      external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/>',
      note: '<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/>',
      copy: '<rect x="8" y="8" width="11" height="12" rx="1"/><path d="M16 8V4H5v12h3"/>',
      quote: '<path d="M5 10h5v5H6c0 2-1 3-3 4M14 10h5v5h-4c0 2-1 3-3 4"/>',
      online: '<circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
      toc: '<path d="M8 5h12M8 12h12M8 19h12M4 5h.01M4 12h.01M4 19h.01"/>',
      warning: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
      image: '<rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 3 3 3-3 5 5"/>',
      expand: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
      home: '<path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7"/>',
    };
    return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.document}</svg>`;
  }

  function brandMarkup() {
    return `
      <svg class="brand__mark" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 19C25 12 16 10 7 12v34c9-2 18 1 25 8V19Z"/>
        <path d="M32 19c7-7 16-9 25-7v34c-9-2-18 1-25 8V19Z"/>
        <path d="M32 19c-5-5-5-11 0-16 5 5 5 11 0 16Z"/>
      </svg>`;
  }

  function typeLabel(value) {
    return {
      livro: "Livro",
      artigo: "Artigo",
      material: "Material",
      apresentacao: "Apresentação",
      tese: "Tese",
      relatorio: "Relatório",
    }[normalize(value)] || (value ? value[0].toLocaleUpperCase("pt-BR") + value.slice(1) : "Documento");
  }

  function coverMarkup(doc, className = "") {
    if (doc?.capa) {
      return `<img class="${className}" src="${escapeHtml(doc.capa)}" alt="Capa de ${escapeHtml(doc.titulo)}" loading="lazy">`;
    }
    return `<span class="cover-placeholder ${className}" aria-hidden="true">Sem capa</span>`;
  }

  function isOnline(doc) {
    return Boolean(doc?.officialFullTextUrl || doc?.officialPageUrl);
  }

  function officialUrl(doc) {
    return doc?.officialFullTextUrl || doc?.officialPageUrl || "";
  }

  function relationLinks(id) {
    const map = new Map();
    const add = (neighborId, patch) => {
      if (!neighborId || neighborId === id || !docsById.has(neighborId)) return;
      const previous = map.get(neighborId) || {
        id: neighborId,
        outgoing: false,
        incoming: false,
        shared: 0,
        similarity: 0,
        evidence: "",
        page: null,
      };
      map.set(neighborId, { ...previous, ...patch,
        outgoing: previous.outgoing || patch.outgoing || false,
        incoming: previous.incoming || patch.incoming || false,
        shared: Math.max(previous.shared || 0, patch.shared || 0),
        similarity: Math.max(previous.similarity || 0, patch.similarity || 0),
        evidence: previous.evidence || patch.evidence || "",
        page: previous.page || patch.page || null,
      });
    };

    (citationData.edges || []).forEach(edge => {
      if (edge.source === id) add(edge.target, { outgoing: true, evidence: edge.evidence, page: edge.page });
      if (edge.target === id) add(edge.source, { incoming: true, evidence: edge.evidence, page: edge.page });
    });
    (affinityData.edges || []).forEach(edge => {
      if (edge.source === id) add(edge.target, {
        shared: Number(edge.sharedReferences) || 0,
        similarity: Number(edge.similarity) || 0,
        evidence: edge.evidence?.[0]?.reference || "",
      });
      if (edge.target === id) add(edge.source, {
        shared: Number(edge.sharedReferences) || 0,
        similarity: Number(edge.similarity) || 0,
        evidence: edge.evidence?.[0]?.reference || "",
      });
    });
    return [...map.values()].sort((a, b) =>
      Number(b.outgoing || b.incoming) - Number(a.outgoing || a.incoming)
      || b.shared - a.shared
      || b.similarity - a.similarity
    );
  }

  function relationCount(id) {
    return relationLinks(id).length;
  }

  function relationKind(link) {
    if (link.outgoing) return "outgoing";
    if (link.incoming) return "incoming";
    if (link.shared > 0) return "shared";
    return "affinity";
  }

  function relationLabel(link) {
    if (link.outgoing && link.incoming) return "Citação nos dois sentidos";
    if (link.outgoing) return "Esta obra cita o documento";
    if (link.incoming) return "O documento cita esta obra";
    if (link.shared > 0) return `${link.shared} referências compartilhadas`;
    return `${Math.round(link.similarity * 100)}% de afinidade temática`;
  }

  function documentSummary(doc) {
    const facts = [
      `${typeLabel(doc.tipo)} de ${doc.assunto || "assunto não informado"}`,
      doc.subassunto ? `subassunto ${doc.subassunto}` : "",
      doc.paginas ? `${doc.paginas} páginas` : "",
      doc.sumario?.length ? `${doc.sumario.length} seções transcritas no sumário` : "sem sumário transcrito",
    ].filter(Boolean);
    return `${facts.join(" · ")}.`;
  }

  function displayTags(doc, limit = 5) {
    const fromTags = (doc.tags || []).flatMap(tag => String(tag).split(/[\/]/g));
    return unique([doc.assunto, doc.subassunto, ...fromTags])
      .filter(item => normalize(item) !== normalize(doc.assunto) && normalize(item) !== normalize(doc.subassunto))
      .slice(0, limit);
  }

  function activeView() {
    if (state.view === "detail") return "catalog";
    if (state.view === "text") return "catalog";
    return state.view;
  }

  function renderHeader() {
    const current = activeView();
    return `
      <header class="site-header">
        <button class="brand" type="button" data-view="catalog" aria-label="Abrir catálogo">
          ${brandMarkup()}
          <span><span class="brand__name">Meu Acervo</span><span class="brand__tagline">Conhecimento sempre à mão</span></span>
        </button>
        <form class="global-search" data-search-form>
          ${icon("search")}
          <label class="sr-only" for="global-query">Buscar documentos</label>
          <input id="global-query" type="search" value="${escapeHtml(state.query)}" placeholder="Buscar por título, assunto, autor, palavra-chave…" autocomplete="off">
          <button type="submit" aria-label="Pesquisar">${icon("arrow")}</button>
        </form>
        <nav id="main-nav" class="main-nav" aria-label="Navegação principal" data-open="${state.menuOpen}">
          ${navButton("catalog", "catalog", "Catálogo", current)}
          ${navButton("collections", "collection", "Coleções", current)}
          ${navButton("quality", "quality", "Qualidade", current)}
          ${navButton("network", "relations", "Relações", current)}
        </nav>
        <div class="header-account">
          <span class="header-account__icon">${icon("user")}</span>
          <p>Estudo hoje,<br>um amanhã maior.</p>
        </div>
        <button class="mobile-menu icon-button" type="button" data-menu aria-controls="main-nav" aria-expanded="${state.menuOpen}" aria-label="${state.menuOpen ? "Fechar menu" : "Abrir menu"}">${state.menuOpen ? icon("close") : icon("menu")}</button>
      </header>`;
  }

  function navButton(view, iconName, label, current) {
    return `<button type="button" data-view="${view}" ${current === view ? 'aria-current="page"' : ""}>${icon(iconName)}<span>${label}</span></button>`;
  }

  function renderModeStrip(extra = "") {
    return `
      <section class="mode-strip" aria-label="Modo de exploração">
        <div class="mode-switch">
          <button type="button" data-search-mode="metadata" aria-pressed="${state.searchMode === "metadata"}">${icon("document")} Metadados</button>
          ${onlineMode ? "" : `<button type="button" data-search-mode="content" aria-pressed="${state.searchMode === "content"}">${icon("text")} Conteúdo completo</button>`}
          ${extra}
        </div>
        <p class="mode-strip__quote">“Livros organizam ideias. Ideias constroem caminhos.”</p>
      </section>`;
  }

  function render() {
    app.innerHTML = `${renderHeader()}<main id="main" class="app-main">${renderView()}</main>${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ""}`;
  }

  function renderView() {
    if (state.view === "collections") return renderCollections();
    if (state.view === "quality") return renderQuality();
    if (state.view === "detail") return renderDetail();
    if (state.view === "network") return renderNetwork();
    if (state.view === "text") return renderTextSearch();
    return renderCatalog();
  }

  function filterValues(field) {
    return unique(docs.map(doc => String(doc[field] || "").trim()))
      .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  }

  function selectOptions(values, selected, emptyLabel) {
    return `<option value="">${emptyLabel}</option>${values.map(value => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
  }

  function renderFilterBar(count) {
    return `
      <section class="filter-bar" aria-label="Filtros do catálogo">
        ${filterSelect("type", filterValues("tipo"), "Tipo")}
        ${filterSelect("subject", filterValues("assunto"), "Assunto")}
        ${filterSelect("subsubject", filterValues("subassunto"), "Subassunto", "filter-control--secondary")}
        ${filterSelect("year", filterValues("ano").sort((a, b) => b.localeCompare(a, "pt-BR", { numeric: true })), "Ano", "filter-control--optional")}
        <label class="filter-control filter-control--optional"><span class="sr-only">Sumário</span><select data-filter="summary"><option value="">Sumário</option><option value="yes" ${state.filters.summary === "yes" ? "selected" : ""}>Com sumário</option><option value="no" ${state.filters.summary === "no" ? "selected" : ""}>Sem sumário</option></select></label>
        <label class="filter-control filter-control--secondary"><span class="sr-only">Leitura oficial</span><select data-filter="online"><option value="">Leitura oficial</option><option value="yes" ${state.filters.online === "yes" ? "selected" : ""}>Disponível online</option><option value="no" ${state.filters.online === "no" ? "selected" : ""}>Somente local</option></select></label>
        <label class="filter-control filter-control--secondary"><span class="sr-only">Qualidade</span><select data-filter="quality"><option value="">Qualidade</option><option value="verified" ${state.filters.quality === "verified" ? "selected" : ""}>Bibliografia verificada</option><option value="pending" ${state.filters.quality === "pending" ? "selected" : ""}>Revisão pendente</option></select></label>
        <strong class="filter-count">${count} ${count === 1 ? "documento" : "documentos"}</strong>
        <div class="view-toggle" role="group" aria-label="Modo de visualização"><button type="button" data-layout="list" aria-pressed="${state.layout === "list"}" aria-label="Lista">${icon("list")}</button><button type="button" data-layout="grid" aria-pressed="${state.layout === "grid"}" aria-label="Grade">${icon("grid")}</button></div>
        <label class="sort-control"><span>Ordenar por</span><select data-sort><option value="title" ${state.sort === "title" ? "selected" : ""}>Título (A–Z)</option><option value="author" ${state.sort === "author" ? "selected" : ""}>Autor</option><option value="year" ${state.sort === "year" ? "selected" : ""}>Ano recente</option></select></label>
        ${hasFilters() ? `<button class="clear-filters" type="button" data-clear-filters>Limpar filtros</button>` : ""}
      </section>`;
  }

  function filterSelect(name, values, label, className = "") {
    return `<label class="filter-control ${className}"><span class="sr-only">${label}</span><select data-filter="${name}">${selectOptions(values, state.filters[name], label)}</select></label>`;
  }

  function hasFilters() {
    return Boolean(state.query || state.collectionOnly || Object.values(state.filters).some(Boolean));
  }

  function filteredDocs() {
    const query = normalize(state.query);
    const terms = query.split(/\s+/).filter(Boolean);
    const result = docs.filter(doc => {
      if (state.collectionOnly && collectionFor(doc) !== state.collectionOnly) return false;
      if (state.filters.type && doc.tipo !== state.filters.type) return false;
      if (state.filters.subject && doc.assunto !== state.filters.subject) return false;
      if (state.filters.subsubject && doc.subassunto !== state.filters.subsubject) return false;
      if (state.filters.year && String(doc.ano || "") !== state.filters.year) return false;
      if (state.filters.summary === "yes" && !doc.sumario?.length) return false;
      if (state.filters.summary === "no" && doc.sumario?.length) return false;
      if (state.filters.online === "yes" && !isOnline(doc)) return false;
      if (state.filters.online === "no" && isOnline(doc)) return false;
      if (state.filters.quality === "verified" && doc.bibStatus !== "verificado") return false;
      if (state.filters.quality === "pending" && doc.bibStatus === "verificado") return false;
      if (!terms.length) return true;
      const searchable = normalize([
        doc.titulo,
        ...(doc.autores || []),
        doc.assunto,
        doc.subassunto,
        doc.publicacao,
        ...(doc.tags || []),
        ...(doc.sumario || []).map(item => item.titulo),
      ].join(" "));
      return terms.every(term => searchable.includes(term));
    });
    result.sort((a, b) => {
      if (state.sort === "author") return (a.autores?.[0] || "").localeCompare(b.autores?.[0] || "", "pt-BR");
      if (state.sort === "year") return Number(b.ano || 0) - Number(a.ano || 0) || a.titulo.localeCompare(b.titulo, "pt-BR");
      return a.titulo.localeCompare(b.titulo, "pt-BR");
    });
    return result;
  }

  function sortedDocs(list) {
    return [...list].sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
  }

  function detailSequence(currentId) {
    const result = filteredDocs();
    return result.some(doc => doc.id === currentId) ? result : sortedDocs(docs);
  }

  function networkSequence(currentId) {
    const relatedDocs = sortedDocs(docs.filter(doc => relationCount(doc.id) > 0));
    if (relatedDocs.some(doc => doc.id === currentId)) return relatedDocs;
    const current = docsById.get(currentId);
    return current ? [current, ...relatedDocs] : relatedDocs;
  }

  function renderDocumentStepper(sequence, currentId, context) {
    const index = Math.max(0, sequence.findIndex(doc => doc.id === currentId));
    const total = sequence.length;
    const attribute = context === "network" ? "data-network-step" : "data-detail-step";
    const label = context === "network" ? "Navegar entre redes bibliográficas" : "Navegar entre fichas";
    return `<nav class="document-stepper" aria-label="${label}"><span><strong>${total ? index + 1 : 0}</strong> de ${total}</span><button type="button" ${attribute}="-1" aria-label="Documento anterior">‹</button><button type="button" ${attribute}="1" aria-label="Próximo documento">›</button></nav>`;
  }

  function scrollPanelsToStart(selectors) {
    window.requestAnimationFrame(() => selectors.forEach(selector => {
      const panel = app.querySelector(selector);
      if (panel) panel.scrollTo({ top: 0, left: 0 });
    }));
  }

  function renderCatalog() {
    const result = filteredDocs();
    const visible = result.slice(0, state.limit);
    const selected = visible.find(doc => doc.id === state.selectedId) || visible[0] || null;
    if (selected && state.selectedId !== selected.id) state.selectedId = selected.id;
    return `${renderModeStrip()}${renderFilterBar(result.length)}
      <section class="catalog-workspace">
        <div class="catalog-results" data-layout="${state.layout}">
          <div class="list-head" aria-hidden="true"><span>Documento</span><span>Tipo</span><span>Assunto</span><span>Sumário</span><span>Leitura oficial</span><span>Relações</span><span></span></div>
          <div class="catalog-list">${visible.length ? visible.map(renderCatalogRow).join("") : renderEmpty("Nenhum documento encontrado", "Remova um filtro ou use termos mais amplos.")}</div>
          ${visible.length < result.length ? `<button class="load-more" type="button" data-load-more>Carregar mais ${Math.min(60, result.length - visible.length)}</button>` : ""}
        </div>
        ${selected ? renderQuickPreview(selected, result.findIndex(doc => doc.id === selected.id) + 1, result.length) : ""}
      </section>`;
  }

  function renderCatalogRow(doc) {
    const relations = relationCount(doc.id);
    return `<button class="catalog-row" type="button" data-select-doc="${escapeHtml(doc.id)}" aria-selected="${doc.id === state.selectedId}">
      <span class="document-cell">${coverMarkup(doc)}<span><h3>${escapeHtml(doc.titulo)}</h3><p>${escapeHtml((doc.autores || []).join("; ") || "Autoria não informada")}</p></span></span>
      <span class="type-badge">${escapeHtml(typeLabel(doc.tipo))}</span>
      <span class="cell-main">${escapeHtml(doc.assunto || "Não informado")}<small>${escapeHtml(doc.subassunto || "")}</small></span>
      <span class="status-chip ${doc.sumario?.length ? "status-chip--ok" : "status-chip--muted"}">${icon("toc")} ${doc.sumario?.length ? "Sim" : "Não"}</span>
      <span class="status-chip ${isOnline(doc) ? "status-chip--ok" : "status-chip--muted"}">${isOnline(doc) ? icon("online") : "○"} ${isOnline(doc) ? "Sim" : "Não"}</span>
      <span class="status-chip ${relations ? "status-chip--ok" : "status-chip--muted"}">${icon("relations")} ${relations}</span>
      <span class="row-arrow">›</span>
    </button>`;
  }

  function renderQuickPreview(doc, index, total) {
    return `<aside class="quick-preview" data-open="${state.previewOpen}" aria-label="Prévia rápida">
      <header class="preview-heading"><h2>${icon("document")} Prévia rápida</h2><span>${Math.max(1, index)} de ${total} <button class="icon-button" type="button" data-preview-step="-1" aria-label="Documento anterior">‹</button><button class="icon-button" type="button" data-preview-step="1" aria-label="Próximo documento">›</button><button class="icon-button" type="button" data-close-preview aria-label="Fechar prévia">${icon("close")}</button></span></header>
      <div class="preview-document">${coverMarkup(doc, "preview-document__cover")}<div><h2>${escapeHtml(doc.titulo)}</h2><dl class="preview-meta"><dt>Tipo</dt><dd>${escapeHtml(typeLabel(doc.tipo))}</dd><dt>Assunto</dt><dd>${escapeHtml(doc.assunto || "Não informado")}</dd><dt>Subassunto</dt><dd>${escapeHtml(doc.subassunto || "Não informado")}</dd></dl><div class="tag-list">${displayTags(doc).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div></div></div>
      <div class="preview-statuses">
        <div class="preview-status">${icon("toc")}<div><strong>Sumário</strong><span>${doc.sumario?.length ? `${doc.sumario.length} seções` : "Não disponível"}</span></div></div>
        <div class="preview-status">${icon("online")}<div><strong>Leitura oficial</strong><span>${isOnline(doc) ? "Disponível" : "Não registrada"}</span></div></div>
      </div>
      <div class="action-row">
        <button class="primary-action" type="button" data-open-detail="${escapeHtml(doc.id)}">${icon("document")} Abrir ficha ${icon("arrow")}</button>
        ${onlineMode ? "" : `<button class="secondary-action" type="button" data-open-pdf="${escapeHtml(doc.id)}">${icon("monitor")} PDF local</button>`}
        ${isOnline(doc) ? `<button class="secondary-action" type="button" data-open-official="${escapeHtml(doc.id)}">${icon("external")} Ler online</button>` : onlineMode ? "" : `<button class="secondary-action" type="button" data-copy-path="${escapeHtml(doc.id)}">${icon("copy")} Copiar caminho</button>`}
      </div>
      <section class="preview-about"><h3>Sobre este documento</h3><p>${escapeHtml(documentSummary(doc))}</p></section>
    </aside>`;
  }

  function renderEmpty(title, description) {
    return `<div class="empty-state"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>`;
  }

  /* Busca no conteúdo completo */

  function queryTerms(value) {
    const stopwords = new Set(textMeta?.stopwords || []);
    return unique(normalize(value).split(/\s+/).filter(term =>
      term.length >= (textMeta?.minTermLength || 3) && !stopwords.has(term) && !/^\d+$/.test(term)
    ));
  }

  function shardKey(term) {
    let value = 2166136261;
    for (let index = 0; index < term.length; index += 1) {
      value = Math.imul(value ^ term.charCodeAt(index), 16777619) >>> 0;
    }
    return (value & 255).toString(16).padStart(2, "0");
  }

  function loadScript(src) {
    if (loadedScripts.has(src)) return loadedScripts.get(src);
    const request = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Não foi possível carregar ${src}`));
      document.head.append(script);
    });
    loadedScripts.set(src, request);
    return request;
  }

  async function loadShard(key) {
    if (!window.CATALOGO_INDICE_SHARDS?.[key]) await loadScript(`indice_textual/shards/${encodeURIComponent(key)}.js`);
    return window.CATALOGO_INDICE_SHARDS?.[key] || {};
  }

  async function loadTextDocument(id) {
    if (!window.CATALOGO_TEXTO_DOCS?.[id]) await loadScript(`indice_textual/docs/${encodeURIComponent(id)}.js`);
    return window.CATALOGO_TEXTO_DOCS?.[id] || { pages: [] };
  }

  function intersect(left, right) {
    const rightSet = new Set(right);
    return left.filter(item => rightSet.has(item));
  }

  function textCandidates(terms, shards) {
    const postings = terms.map((term, index) => new Map((shards[index]?.[term] || []).map(([id, pages]) => [id, pages])));
    if (postings.some(item => item.size === 0)) return [];
    return [...postings[0].keys()].filter(id => postings.every(item => item.has(id))).map(id => {
      const pageLists = postings.map(item => item.get(id));
      const commonPages = pageLists.slice(1).reduce(intersect, pageLists[0]);
      return {
        id,
        pages: commonPages.length ? commonPages : unique(pageLists.flat()).sort((a, b) => a - b),
        samePage: commonPages.length > 0,
      };
    }).sort((a, b) => Number(b.samePage) - Number(a.samePage) || (a.pages[0] || 0) - (b.pages[0] || 0));
  }

  function snippet(value, terms) {
    const compact = String(value || "").replace(/\s+/g, " ").trim();
    if (!compact) return "Página sem texto extraível.";
    const folded = normalize(compact);
    const positions = terms.map(term => folded.indexOf(term)).filter(index => index >= 0);
    const position = positions.length ? Math.min(...positions) : 0;
    const ratio = folded.length ? position / folded.length : 0;
    const original = Math.floor(compact.length * ratio);
    const start = Math.max(0, original - 90);
    const end = Math.min(compact.length, original + 290);
    return `${start ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
  }

  function highlight(value, terms) {
    let escaped = escapeHtml(value);
    terms.forEach(term => {
      const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      escaped = escaped.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
    });
    return escaped;
  }

  async function runTextSearch() {
    state.view = "text";
    state.searchMode = "content";
    const terms = queryTerms(state.query);
    if (!textMeta) {
      state.textStatus = "O índice textual não está disponível.";
      state.textResults = [];
      render();
      return;
    }
    if (!terms.length) {
      state.textStatus = "Digite ao menos um termo informativo com três ou mais letras.";
      state.textResults = [];
      render();
      return;
    }
    state.textLoading = true;
    state.textStatus = "Consultando o índice textual local…";
    render();
    try {
      const shards = await Promise.all(terms.map(term => loadShard(shardKey(term))));
      const hits = textCandidates(terms, shards);
      const visible = hits.slice(0, 52);
      const pageDocs = await Promise.all(visible.map(hit => loadTextDocument(hit.id)));
      state.textResults = visible.map((hit, index) => {
        const page = hit.pages[0] || 1;
        const text = pageDocs[index].pages?.[page - 1] || "";
        return { ...hit, page, snippet: snippet(text, terms), terms };
      });
      state.textStatus = hits.length
        ? `${hits.length} ${hits.length === 1 ? "documento encontrado" : "documentos encontrados"} · ${hits.reduce((sum, hit) => sum + hit.pages.length, 0)} trechos localizados`
        : "Nenhuma página contém todos os termos pesquisados.";
    } catch (error) {
      state.textResults = [];
      state.textStatus = `Falha ao consultar o índice local: ${error.message}`;
    } finally {
      state.textLoading = false;
      render();
    }
  }

  function renderTextSearch() {
    const filtered = filteredTextResults();
    return `${renderModeStrip()}
      <section class="filter-bar" aria-label="Filtros da busca textual">
        ${filterSelect("type", filterValues("tipo"), "Tipo")}
        ${filterSelect("subject", filterValues("assunto"), "Assunto")}
        ${filterSelect("year", filterValues("ano").sort((a, b) => b.localeCompare(a, "pt-BR", { numeric: true })), "Ano")}
        <strong class="filter-count">${filtered.length} ${filtered.length === 1 ? "resultado exibido" : "resultados exibidos"}</strong>
        <label class="sort-control"><span>Ordenar por</span><select disabled><option>Relevância</option></select></label>
      </section>
      <section class="text-search-layout">
        <div class="text-results">
          <header class="text-results__head"><h2>Resultados no conteúdo completo</h2><p class="text-status">${escapeHtml(state.textStatus)}</p></header>
          ${state.textLoading ? renderEmpty("Consultando o índice", "A busca é executada somente nos arquivos locais indexados.") : renderTextRows()}
        </div>
        <aside class="text-help">
          <h2>Sobre esta busca</h2>
          <div class="help-card"><h3>${icon("search")} Conteúdo completo</h3><p>Pesquisa no texto extraído de ${textMeta?.indexados || 0} PDFs, incluindo capítulos, tabelas, figuras e referências.</p></div>
          <div class="help-card"><h3>Termo pesquisado</h3><p>${state.query ? `“${escapeHtml(state.query)}”` : "Nenhum termo informado"}</p></div>
          <div class="help-card"><h3>Dicas rápidas</h3><ul><li>Use expressões específicas.</li><li>Combine termos que devem aparecer no mesmo documento.</li><li>Abra a ficha para consultar metadados e relações.</li></ul></div>
        </aside>
      </section>`;
  }

  function renderTextRows() {
    if (!state.textResults.length) return renderEmpty("Nenhum trecho para exibir", state.textStatus);
    const filtered = filteredTextResults();
    if (!filtered.length) return renderEmpty("Nenhum trecho corresponde aos filtros", "Limpe um filtro ou escolha valores mais amplos.");
    return filtered.map(hit => {
      const doc = docsById.get(hit.id);
      return `<article class="text-row">
        <div class="document-cell">${coverMarkup(doc)}<div><h3>${escapeHtml(doc.titulo)}</h3><p>${escapeHtml((doc.autores || []).join("; ") || "Autoria não informada")}</p></div></div>
        <p class="text-snippet">${highlight(hit.snippet, hit.terms)}</p>
        <p class="text-pages">Página ${hit.page}${hit.pages.length > 1 ? `<br>e mais ${hit.pages.length - 1}` : ""}</p>
        <div class="text-actions">${onlineMode ? "" : `<button class="primary-action" type="button" data-open-pdf="${escapeHtml(doc.id)}" data-page="${hit.page}">Ir ao trecho</button>`}<button class="secondary-action" type="button" data-open-detail="${escapeHtml(doc.id)}">Abrir ficha</button></div>
      </article>`;
    }).join("");
  }

  function filteredTextResults() {
    return state.textResults.filter(hit => {
      const doc = docsById.get(hit.id);
      if (!doc) return false;
      if (state.filters.type && doc.tipo !== state.filters.type) return false;
      if (state.filters.subject && doc.assunto !== state.filters.subject) return false;
      if (state.filters.year && String(doc.ano || "") !== state.filters.year) return false;
      return true;
    });
  }

  /* Coleções */

  const collectionDefs = [
    {
      id: "statistics",
      title: "Estatística e Probabilidade",
      description: "Fundamentos teóricos, inferência, probabilidade e modelagem estatística.",
      match: /estat|probab|matem|infer|econometr/i,
      icon: "quality",
    },
    {
      id: "computing",
      title: "Computação e Ciência de Dados",
      description: "Algoritmos, programação, aprendizado de máquina e computação científica.",
      match: /machine|program|computa|dados|intelig|deep|islr|torch|python|redes/i,
      icon: "monitor",
    },
    {
      id: "economics",
      title: "Economia e Métodos Quantitativos",
      description: "Economia, finanças, séries temporais e métodos aplicados.",
      match: /econom|finan|mercado|política|politica/i,
      icon: "collection",
    },
    {
      id: "communication",
      title: "Comunicação e Visualização",
      description: "Escrita acadêmica, design, jornalismo e visualização de dados.",
      match: /comunica|visual|jornal|design|latex|escrita/i,
      icon: "document",
    },
  ];

  function collectionFor(doc) {
    const text = `${doc.assunto || ""} ${doc.subassunto || ""} ${(doc.tags || []).join(" ")}`;
    return collectionDefs.find(group => group.match.test(text))?.id || "other";
  }

  function renderCollections() {
    const result = filteredDocs();
    const groups = collectionDefs.map(def => ({ ...def, docs: result.filter(doc => collectionFor(doc) === def.id) }));
    const assigned = new Set(groups.flatMap(group => group.docs.map(doc => doc.id)));
    const otherDocs = result.filter(doc => !assigned.has(doc.id));
    if (otherDocs.length) groups.push({ id: "other", title: "Outros campos", description: "Obras de áreas não abrangidas pelas coleções temáticas principais.", icon: "catalog", docs: otherDocs });
    const subjects = filterValues("assunto").slice(0, 12);
    const cards = groups.map(renderCollectionCard).filter(Boolean).join("");
    return `${renderModeStrip()}${renderFilterBar(result.length)}
      <div class="page-shell">
        <div class="collections-layout">
          <aside class="facet-panel"><div class="facet-panel__head"><h2>Filtros</h2><button type="button" data-clear-filters>Limpar filtros</button></div><div class="facet-group"><h3>Assunto</h3>${subjects.map(subject => `<label><input type="checkbox" data-collection-subject="${escapeHtml(subject)}" ${state.filters.subject === subject ? "checked" : ""}>${escapeHtml(subject)} (${docs.filter(doc => doc.assunto === subject).length})</label>`).join("")}</div><div class="facet-group"><h3>Tipo</h3>${filterValues("tipo").map(type => `<label><input type="checkbox" data-collection-type="${escapeHtml(type)}" ${state.filters.type === type ? "checked" : ""}>${escapeHtml(typeLabel(type))} (${docs.filter(doc => doc.tipo === type).length})</label>`).join("")}</div></aside>
          <section><header class="page-title"><div><h1>Coleções</h1><p>Explore o acervo por grandes áreas sustentadas pelos metadados reais.</p></div></header><div class="collection-grid">${cards || renderEmpty("Nenhuma coleção corresponde aos filtros", "Limpe um filtro ou escolha valores mais amplos.")}</div></section>
        </div>
      </div>`;
  }

  function renderCollectionCard(group) {
    const items = group.docs;
    const featured = items.filter(doc => doc.capa).slice(0, 2);
    if (!items.length) return "";
    return `<article class="collection-card"><header class="collection-card__head"><span class="collection-card__icon">${icon(group.icon)}</span><div><h2>${escapeHtml(group.title)}</h2><p>${escapeHtml(group.description)}</p></div><span class="collection-card__count">${items.length} documentos</span></header><div class="collection-books">${featured.map(doc => `<button class="collection-book" type="button" data-open-detail="${escapeHtml(doc.id)}">${coverMarkup(doc)}<span><strong>${escapeHtml(doc.titulo)}</strong><span>${escapeHtml(doc.assunto || "")}<br>${escapeHtml(doc.subassunto || "")}</span><span class="type-badge">${escapeHtml(typeLabel(doc.tipo))}</span></span></button>`).join("")}</div><button class="collection-card__open" type="button" data-open-collection="${escapeHtml(group.id)}">Ver ${items.length} documentos →</button></article>`;
  }

  /* Qualidade */

  const qualityIssues = [
    { id: "bibliography", label: "Bibliografia pendente", icon: "document", priority: "Alta", test: doc => doc.bibStatus !== "verificado", note: "Metadados bibliográficos ainda precisam de verificação." },
    { id: "summary", label: "Sem sumário", icon: "toc", priority: "Média", test: doc => !doc.sumario?.length, note: "Nenhum sumário foi associado ao documento." },
    { id: "read", label: "Falha de leitura", icon: "warning", priority: "Alta", test: doc => doc.pdfStatus !== "ok", note: "O PDF não pôde ser processado normalmente." },
    { id: "text", label: "Sem texto pesquisável", icon: "search", priority: "Alta", test: doc => textMeta?.statusPorDocumento?.[doc.id] !== "ok", note: "O índice textual não contém texto utilizável deste PDF." },
    { id: "cover", label: "Sem miniatura", icon: "image", priority: "Média", test: doc => !doc.capa, note: "Nenhuma capa ou miniatura foi localizada." },
    { id: "references", label: "Referências não detectadas", icon: "quote", priority: "Média", test: doc => citationExtraction.get(doc.id)?.status !== "ok", note: "Nenhuma seção bibliográfica rastreável foi confirmada." },
    { id: "affinity", label: "Afinidade não calculável", icon: "relations", priority: "Baixa", test: doc => affinityExtraction.get(doc.id)?.status !== "rastreavel", note: "Não há informação suficiente para calcular afinidade bibliográfica." },
  ];

  function issuesFor(doc) {
    return qualityIssues.filter(issue => issue.test(doc));
  }

  function qualityDocs() {
    return docs.filter(doc => {
      const issues = issuesFor(doc);
      return state.qualityIssue === "all" ? issues.length : issues.some(issue => issue.id === state.qualityIssue);
    });
  }

  function renderQuality() {
    const problemDocs = docs.filter(doc => issuesFor(doc).length);
    const visible = qualityDocs();
    return `<section class="mode-strip" aria-label="Modo de revisão"><div class="mode-switch"><button type="button" aria-pressed="true">${icon("quality")} Qualidade do catálogo</button>${onlineMode ? "" : `<button type="button" data-search-mode="content" aria-pressed="false">${icon("text")} Conteúdo completo</button>`}</div><p class="mode-strip__quote">“Livros organizam ideias. Ideias constroem caminhos.”</p></section><div class="page-shell">
      <header class="page-title"><div><h1>Qualidade do catálogo</h1><p>Identifique documentos que precisam de atenção para manter o acervo completo e confiável.</p></div></header>
      <div class="quality-layout">
        <div>
          <div class="quality-cards">${qualityIssues.map(issue => {
            const count = docs.filter(issue.test).length;
            return `<button class="quality-card" type="button" data-quality-issue="${issue.id}" aria-pressed="${state.qualityIssue === issue.id}"><span class="quality-card__icon">${icon(issue.icon)}</span><span><span>${escapeHtml(issue.label)}</span><strong>${count}</strong><span>${issue.priority}</span></span></button>`;
          }).join("")}</div>
          <section><header class="page-title"><div><h1 style="font-size:1.65rem">Fila de revisão</h1><p>Um documento pode apresentar mais de um problema.</p></div><strong>${visible.length} ${visible.length === 1 ? "documento" : "documentos"}</strong></header>
            <div class="review-table"><div class="review-head"><span>Documento</span><span>Tipo</span><span>Problemas detectados</span><span>Observação</span><span>Abrir</span></div>${visible.map(renderReviewRow).join("")}</div>
          </section>
        </div>
        <aside class="quality-aside">
          <div class="quality-panel"><h2>${icon("document")} Resumo da qualidade</h2>${qualityIssues.map(issue => `<div class="quality-summary-row"><span>${escapeHtml(issue.label)}</span><strong>${docs.filter(issue.test).length}</strong></div>`).join("")}<div class="quality-summary-row"><strong>Total com problemas</strong><strong>${problemDocs.length}</strong></div></div>
          <div class="quality-panel"><h3>${icon("filter")} Filtros rápidos</h3><button class="quality-summary-row" style="width:100%;border:0;border-bottom:1px solid var(--line);background:${state.qualityIssue === "all" ? "var(--green-pale)" : "transparent"}" type="button" data-quality-issue="all"><span>Todos os problemas</span><strong>${problemDocs.length}</strong></button>${qualityIssues.map(issue => `<button class="quality-summary-row" style="width:100%;border:0;border-bottom:1px solid var(--line);background:${state.qualityIssue === issue.id ? "var(--green-pale)" : "transparent"}" type="button" data-quality-issue="${issue.id}"><span>${escapeHtml(issue.label)}</span><strong>${docs.filter(issue.test).length}</strong></button>`).join("")}</div>
        </aside>
      </div>
    </div>`;
  }

  function renderReviewRow(doc) {
    const issues = issuesFor(doc);
    const mostRelevant = state.qualityIssue === "all" ? issues[0] : issues.find(issue => issue.id === state.qualityIssue) || issues[0];
    return `<article class="review-row"><div class="document-cell">${coverMarkup(doc)}<div><h3>${escapeHtml(doc.titulo)}</h3><p>${escapeHtml((doc.autores || []).join("; ") || typeLabel(doc.tipo))}</p></div></div><span class="type-badge">${escapeHtml(typeLabel(doc.tipo))}</span><div class="problem-list">${issues.slice(0, 3).map(issue => `<span class="status-chip ${issue.priority === "Alta" ? "status-chip--danger" : issue.priority === "Média" ? "status-chip--warn" : "status-chip--muted"}">${escapeHtml(issue.label)}</span>`).join("")}</div><span class="cell-main">${escapeHtml(mostRelevant?.note || "Revisão necessária.")}</span><button class="secondary-action" type="button" data-open-detail="${escapeHtml(doc.id)}">Abrir</button></article>`;
  }

  /* Ficha do documento */

  function renderDetail() {
    const doc = docsById.get(state.selectedId) || preferred;
    if (!doc) return renderEmpty("Documento indisponível", "O registro solicitado não está mais no catálogo.");
    const sequence = detailSequence(doc.id);
    const relations = relationLinks(doc.id);
    const citations = relations.filter(link => link.outgoing);
    const related = relations.filter(link => link.shared || link.similarity).slice(0, 8);
    const formats = ["bibtex", "apa", "abnt"];
    return `<section class="detail-page">
      <div class="detail-main">
        <header class="detail-toolbar"><nav class="breadcrumbs" aria-label="Navegação estrutural"><button type="button" data-view="catalog">${icon("home")} Catálogo</button><span>›</span><button type="button" data-filter-link="subject" data-value="${escapeHtml(doc.assunto || "")}">${escapeHtml(doc.assunto || "Sem assunto")}</button><span>›</span><button type="button" data-filter-link="subsubject" data-value="${escapeHtml(doc.subassunto || "")}">${escapeHtml(doc.subassunto || "Sem subassunto")}</button><span>›</span><span>${escapeHtml(doc.titulo)}</span></nav></header>
        <section class="detail-hero">${coverMarkup(doc, "detail-cover")}<div class="detail-identity"><div class="detail-title"><span class="type-badge">${escapeHtml(typeLabel(doc.tipo))}</span><h1>${escapeHtml(doc.titulo)}</h1><p class="detail-authors">${escapeHtml((doc.autores || []).join("; ") || "Autoria não informada")}</p><div class="detail-subjects"><span>Assunto</span><strong>${escapeHtml(doc.assunto || "Não informado")}</strong><span>Subassunto</span><strong>${escapeHtml(doc.subassunto || "Não informado")}</strong></div><div class="tag-list">${displayTags(doc, 6).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div></div><div class="detail-actions-nav">${renderDocumentStepper(sequence, doc.id, "detail")}</div>${renderActionGroups(doc)}</div></section>
        <section class="detail-section"><h2>${icon("document")} Identificação bibliográfica</h2><div class="biblio-grid">${biblioRow(biblioItem("Título", doc.titulo), biblioItem("Tipo de documento", typeLabel(doc.tipo)))}${biblioRow(biblioItem("Autor(es)", (doc.autores || []).join("; ")), biblioItem("Assunto", doc.assunto))}${biblioRow(biblioItem("Ano", doc.ano), biblioItem("Subassunto", doc.subassunto))}${biblioRow(biblioItem("Publicação", doc.publicacao), biblioItem("Páginas", doc.paginas))}${biblioRow(biblioItem("Qualidade bibliográfica", doc.bibStatus === "verificado" ? "Verificada" : "Pendente"), biblioItem("Fonte da verificação", doc.bibFonte))}</div></section>
        <section class="detail-section"><h2>${icon("quote")} Formatos de referência</h2><div class="citation-grid">${formats.map(format => renderCitationCard(doc, format)).join("")}</div></section>
      </div>
      <aside class="detail-rail">
        <div class="detail-tabs" role="tablist" aria-label="Informações complementares do documento">
          ${detailTab("toc", "toc", "Sumário")}
          ${detailTab("references", "quote", "Referências citadas", citations.length)}
          ${detailTab("related", "collection", "Documentos relacionados", related.length)}
          ${detailTab("relations", "relations", "Relações bibliográficas", relations.length)}
        </div>
        <div id="detail-panel" class="detail-panel" role="tabpanel" tabindex="0">${renderDetailRail(doc, citations, related, relations)}</div>
      </aside>
    </section>`;
  }

  function renderActionGroups(doc) {
    if (onlineMode) {
      return `<div class="action-groups action-groups--online"><section class="action-group"><h2>${icon("globe")} Ações públicas</h2><div class="action-group__buttons">${isOnline(doc) ? `<button class="primary-action" type="button" data-open-official="${escapeHtml(doc.id)}">${icon("external")} Ler online ${icon("chevron")}</button>` : `<p class="online-notice">Nenhum acesso público registrado.</p>`}<button type="button" data-copy-citation="${escapeHtml(doc.id)}" data-format="apa">${icon("quote")} Copiar citação APA</button><button type="button" data-open-network="${escapeHtml(doc.id)}">${icon("relations")} Explorar relações</button></div></section></div>`;
    }
    return `<div class="action-groups"><section class="action-group"><h2>${icon("monitor")} Ações locais</h2><div class="action-group__buttons"><button class="primary-action" type="button" data-open-pdf="${escapeHtml(doc.id)}">${icon("document")} Abrir PDF local ${icon("chevron")}</button>${doc.notaUri ? `<button type="button" data-open-note="${escapeHtml(doc.id)}">${icon("note")} Abrir nota local</button>` : ""}<button type="button" data-copy-path="${escapeHtml(doc.id)}">${icon("copy")} Copiar caminho</button></div></section><section class="action-group"><h2>${icon("globe")} Ações públicas</h2><div class="action-group__buttons">${isOnline(doc) ? `<button type="button" data-open-official="${escapeHtml(doc.id)}">${icon("external")} Ler online</button>` : `<p style="font:0.78rem var(--serif);color:var(--ink-soft)">Nenhum acesso público registrado.</p>`}<button type="button" data-copy-citation="${escapeHtml(doc.id)}" data-format="apa">${icon("quote")} Copiar citação APA</button><button type="button" data-open-network="${escapeHtml(doc.id)}">${icon("relations")} Explorar relações</button></div></section></div>`;
  }

  function biblioItem(label, value) {
    return `<div class="biblio-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Não informado")}</strong></div>`;
  }

  function biblioRow(...items) {
    return `<div class="biblio-row">${items.join("")}</div>`;
  }

  function renderCitationCard(doc, format) {
    const label = { bibtex: "BibTeX", apa: "APA", abnt: "ABNT" }[format];
    const value = window.Citacoes?.format ? window.Citacoes.format(doc, format) : format === "bibtex" ? doc.bibtex : "Formato indisponível";
    return `<article class="citation-card"><header><h3>${label}</h3><button type="button" data-copy-citation="${escapeHtml(doc.id)}" data-format="${format}">${icon("copy")} Copiar</button></header>${format === "bibtex" ? `<pre>${escapeHtml(value)}</pre>` : `<p>${escapeHtml(value)}</p>`}</article>`;
  }

  function detailTab(id, iconName, label, count = null) {
    const selected = state.detailTab === id;
    return `<button type="button" role="tab" data-detail-tab="${id}" aria-selected="${selected}" aria-controls="detail-panel" tabindex="${selected ? 0 : -1}">${icon(iconName)} <span>${label}${count !== null ? ` <b>${count}</b>` : ""}</span></button>`;
  }

  function renderDetailRail(doc, citations, related, relations) {
    if (state.detailTab === "references") return renderRelationPanel("Referências citadas", citations, "Nenhuma obra local foi identificada na bibliografia deste documento.");
    if (state.detailTab === "related") return renderRelationPanel("Documentos relacionados", related, "Não há documentos relacionados calculáveis.");
    if (state.detailTab === "relations") return `<section class="rail-panel"><header class="rail-panel__head"><h2>${icon("relations")} Relações bibliográficas</h2><button type="button" data-open-network="${escapeHtml(doc.id)}">Abrir rede</button></header>${renderRelationItems(relations, "Nenhuma relação local confirmada.")}</section>`;
    return renderTocPanel(doc);
  }

  function renderRelationPanel(title, links, empty) {
    return `<section class="rail-panel"><header class="rail-panel__head"><h2>${icon("collection")} ${escapeHtml(title)}</h2></header>${renderRelationItems(links, empty)}</section>`;
  }

  function renderRelationItems(links, empty) {
    if (!links.length) return renderEmpty("Sem resultados", empty);
    return `<div class="relation-list">${links.map(link => {
      const doc = docsById.get(link.id);
      return `<button class="relation-item" type="button" data-open-detail="${escapeHtml(doc.id)}">${coverMarkup(doc)}<span><strong>${escapeHtml(doc.titulo)}</strong><span>${escapeHtml(relationLabel(link))}</span></span>${icon("chevron")}</button>`;
    }).join("")}</div>`;
  }

  function buildToc(entries) {
    const root = [];
    const stack = [{ level: 0, children: root }];
    entries.forEach((entry, index) => {
      const level = Math.max(1, Number(entry.nivel) || 1);
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const node = { ...entry, level, children: [], index };
      stack[stack.length - 1].children.push(node);
      stack.push({ level, children: node.children });
    });
    return root;
  }

  function renderTocNodes(nodes, depth = 1) {
    return `<ul>${nodes.map((node, index) => {
      const content = `<span>${escapeHtml(node.titulo)}</span><span class="toc-page">${node.pagina ? escapeHtml(node.pagina) : ""}</span>`;
      if (node.children.length) return `<li><details ${depth === 1 && index < 4 ? "open" : ""}><summary>${content}</summary>${renderTocNodes(node.children, depth + 1)}</details></li>`;
      return `<li><div class="toc-leaf">${content}</div></li>`;
    }).join("")}</ul>`;
  }

  function renderTocPanel(doc) {
    if (!doc.sumario?.length) return `<section class="rail-panel"><header class="rail-panel__head"><h2>${icon("toc")} Sumário</h2></header>${renderEmpty("Sumário indisponível", "Nenhum sumário em Markdown foi associado a esta obra.")}</section>`;
    return `<section class="rail-panel"><header class="rail-panel__head"><h2>${icon("toc")} Sumário</h2><span><button type="button" data-toc-action="expand">Expandir tudo</button> | <button type="button" data-toc-action="collapse">Recolher tudo</button></span></header><div class="toc-tree">${renderTocNodes(buildToc(doc.sumario))}</div></section>`;
  }

  /* Rede bibliográfica */

  function visibleNetworkLinks(id) {
    return relationLinks(id).filter(link =>
      (link.outgoing && state.networkFilters.outgoing)
      || (link.incoming && state.networkFilters.incoming)
      || (link.shared > 0 && state.networkFilters.shared)
      || (!link.outgoing && !link.incoming && !link.shared && link.similarity > 0 && state.networkFilters.affinity)
    );
  }

  function renderNetwork() {
    const center = docsById.get(state.networkId) || preferred;
    if (!center) return renderEmpty("Rede indisponível", "Nenhum documento central foi selecionado.");
    const sequence = networkSequence(center.id);
    const links = visibleNetworkLinks(center.id);
    const visible = links.slice(0, 6);
    const target = links.find(link => link.id === state.networkTargetId) || visible[0] || null;
    if (target && state.networkTargetId !== target.id) state.networkTargetId = target.id;
    return `${renderModeStrip(`<button type="button" aria-pressed="true">${icon("relations")} Relações bibliográficas</button>`)}
      <section class="network-page">
        <aside class="network-sidebar"><h2>Explorar relações</h2><div class="relation-types"><strong>Tipo de relação</strong>${networkFilter("outgoing", "Cita", "line-key")}${networkFilter("incoming", "É citado por", "line-key--incoming")}${networkFilter("shared", "Referências compartilhadas", "line-key--shared")}${networkFilter("affinity", "Afinidade temática", "line-key--affinity")}</div><label class="global-search" style="margin-bottom:.8rem">${icon("search")}<input type="search" data-network-search placeholder="Buscar na rede…"></label><p><strong>Obras relacionadas (${links.length})</strong></p>${links.map(link => renderNetworkListButton(link, target?.id)).join("")}</aside>
        <section class="network-canvas"><header class="network-canvas__head"><div><h1>Rede bibliográfica</h1><p>Obras relacionadas a “${escapeHtml(center.titulo)}”</p></div>${renderDocumentStepper(sequence, center.id, "network")}</header>${renderGraph(center, visible, target?.id)}</section>
        ${renderNetworkDetail(center, target)}
      </section>`;
  }

  function networkFilter(id, label, keyClass) {
    return `<label><input type="checkbox" data-network-filter="${id}" ${state.networkFilters[id] ? "checked" : ""}><span>${label}</span><i class="line-key ${keyClass}"></i></label>`;
  }

  function renderNetworkListButton(link, selectedId) {
    const doc = docsById.get(link.id);
    return `<button class="network-list-button" type="button" data-network-target="${escapeHtml(link.id)}" aria-selected="${link.id === selectedId}">${coverMarkup(doc)}<span><strong>${escapeHtml(doc.titulo)}</strong><span>${escapeHtml(doc.assunto || typeLabel(doc.tipo))}</span></span>${icon("chevron")}</button>`;
  }

  const graphPositions = [
    { x: 500, y: 88 },
    { x: 805, y: 168 },
    { x: 805, y: 458 },
    { x: 500, y: 560 },
    { x: 195, y: 458 },
    { x: 195, y: 168 },
  ];

  function renderGraph(center, links, selectedId) {
    const lines = links.map((link, index) => {
      const position = graphPositions[index];
      const kind = relationKind(link);
      const from = link.incoming && !link.outgoing ? position : { x: 500, y: 324 };
      const to = link.incoming && !link.outgoing ? { x: 500, y: 324 } : position;
      const labelX = (position.x + 500) / 2;
      const labelY = (position.y + 324) / 2 - 8;
      const label = kind === "outgoing" ? "cita" : kind === "incoming" ? "é citado por" : kind === "shared" ? `${link.shared} refs.` : `${Math.round(link.similarity * 100)}%`;
      return `<line class="graph-line graph-line--${kind}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" marker-end="url(#arrow-${kind})"/><text x="${labelX}" y="${labelY}" text-anchor="middle" fill="#52635b" font-family="Georgia" font-size="13">${escapeHtml(label)}</text>`;
    }).join("");
    const nodes = links.map((link, index) => {
      const doc = docsById.get(link.id);
      const position = graphPositions[index];
      return `<button class="graph-node" type="button" data-network-target="${escapeHtml(doc.id)}" aria-pressed="${doc.id === selectedId}" style="left:${position.x / 10}%;top:${position.y / 6.4}%">${coverMarkup(doc)}<strong>${escapeHtml(doc.titulo)}</strong></button>`;
    }).join("");
    return `<div class="graph"><svg viewBox="0 0 1000 640" aria-hidden="true"><defs><marker id="arrow-outgoing" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#0b4a32"/></marker><marker id="arrow-incoming" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#a47a20"/></marker><marker id="arrow-shared" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#265f86"/></marker><marker id="arrow-affinity" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#86a69b"/></marker></defs>${lines}</svg>${nodes}<button class="graph-node graph-node--center" type="button" data-open-detail="${escapeHtml(center.id)}" style="left:50%;top:50.6%">${coverMarkup(center)}<strong>${escapeHtml(center.titulo)}</strong></button></div>`;
  }

  function renderNetworkDetail(center, link) {
    if (!link) return `<aside class="network-detail"><h2>Detalhes da relação</h2>${renderEmpty("Nenhuma relação visível", "Ative um tipo de relação ou escolha outro documento central.")}</aside>`;
    const target = docsById.get(link.id);
    return `<aside class="network-detail"><h2>Detalhes da relação</h2><div class="network-detail__pair"><div>${coverMarkup(center)}<strong>${escapeHtml(center.titulo)}</strong></div><span class="network-arrow">${link.incoming && !link.outgoing ? "←" : "→"}</span><div>${coverMarkup(target)}<strong>${escapeHtml(target.titulo)}</strong></div></div><dl class="relation-facts"><div><dt>Tipo de relação</dt><dd>${escapeHtml(relationLabel(link))}</dd></div><div><dt>Direção</dt><dd>${link.outgoing ? `${escapeHtml(center.titulo)} → ${escapeHtml(target.titulo)}` : link.incoming ? `${escapeHtml(target.titulo)} → ${escapeHtml(center.titulo)}` : "Relação simétrica"}</dd></div><div><dt>Evidência</dt><dd>${escapeHtml(truncate(link.evidence || "Relação calculada a partir dos metadados e referências locais.", 420))}</dd></div>${link.page ? `<div><dt>Página</dt><dd>${link.page}</dd></div>` : ""}${link.shared ? `<div><dt>Referências compartilhadas</dt><dd>${link.shared}</dd></div>` : ""}${link.similarity ? `<div><dt>Afinidade</dt><dd>${Math.round(link.similarity * 100)}%</dd></div>` : ""}</dl><button class="primary-action" style="width:100%;margin-top:1rem" type="button" data-open-detail="${escapeHtml(target.id)}">Abrir ficha de ${escapeHtml(truncate(target.titulo, 42))} ${icon("arrow")}</button></aside>`;
  }

  /* Interações */

  function setView(view) {
    if (onlineMode && view === "text") view = "catalog";
    state.view = view;
    state.menuOpen = false;
    state.previewOpen = false;
    if (view === "catalog") state.searchMode = "metadata";
    if (view === "collections") state.collectionOnly = "";
    if (view === "network") state.networkId = state.selectedId || preferred?.id || "";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openDocumentUri(doc, page = null) {
    if (!doc?.pdfUri) return showToast("O PDF local não está disponível.");
    const suffix = page ? `#page=${Number(page) || 1}` : "";
    window.open(`${doc.pdfUri}${suffix}`, "_blank", "noopener");
  }

  function showToast(message) {
    state.toast = message;
    render();
    window.setTimeout(() => {
      if (state.toast === message) {
        state.toast = "";
        render();
      }
    }, 2400);
  }

  async function copyText(value, success) {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      showToast(success);
    } catch {
      showToast("Não foi possível copiar automaticamente.");
    }
  }

  app.addEventListener("click", event => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) return setView(viewButton.dataset.view);

    const menu = event.target.closest("[data-menu]");
    if (menu) {
      state.menuOpen = !state.menuOpen;
      render();
      window.requestAnimationFrame(() => app.querySelector("[data-menu]")?.focus());
      return;
    }

    const mode = event.target.closest("[data-search-mode]");
    if (mode) {
      if (onlineMode && mode.dataset.searchMode === "content") return;
      state.searchMode = mode.dataset.searchMode;
      if (state.searchMode === "content") {
        state.view = "text";
        if (state.query) return runTextSearch();
      } else {
        state.view = "catalog";
      }
      return render();
    }

    const layout = event.target.closest("button[data-layout]");
    if (layout) {
      state.layout = layout.dataset.layout;
      return render();
    }

    const selected = event.target.closest("[data-select-doc]");
    if (selected) {
      state.selectedId = selected.dataset.selectDoc;
      state.previewOpen = true;
      return render();
    }

    if (event.target.closest("[data-close-preview]")) {
      state.previewOpen = false;
      return render();
    }

    const previewStep = event.target.closest("[data-preview-step]");
    if (previewStep) {
      const result = filteredDocs();
      const current = Math.max(0, result.findIndex(doc => doc.id === state.selectedId));
      const next = (current + Number(previewStep.dataset.previewStep) + result.length) % Math.max(1, result.length);
      if (result[next]) state.selectedId = result[next].id;
      return render();
    }

    const detailStep = event.target.closest("[data-detail-step]");
    if (detailStep) {
      const sequence = detailSequence(state.selectedId);
      const current = Math.max(0, sequence.findIndex(doc => doc.id === state.selectedId));
      const next = (current + Number(detailStep.dataset.detailStep) + sequence.length) % Math.max(1, sequence.length);
      if (sequence[next]) state.selectedId = sequence[next].id;
      render();
      scrollPanelsToStart([".detail-main", ".detail-rail"]);
      return;
    }

    const networkStep = event.target.closest("[data-network-step]");
    if (networkStep) {
      const sequence = networkSequence(state.networkId);
      const current = Math.max(0, sequence.findIndex(doc => doc.id === state.networkId));
      const next = (current + Number(networkStep.dataset.networkStep) + sequence.length) % Math.max(1, sequence.length);
      if (sequence[next]) {
        state.networkId = sequence[next].id;
        state.selectedId = sequence[next].id;
        state.networkTargetId = "";
      }
      render();
      scrollPanelsToStart([".network-sidebar", ".network-canvas", ".network-detail"]);
      return;
    }

    const detail = event.target.closest("[data-open-detail]");
    if (detail) {
      state.selectedId = detail.dataset.openDetail;
      state.detailTab = "toc";
      return setView("detail");
    }

    const pdf = event.target.closest("[data-open-pdf]");
    if (pdf) return openDocumentUri(docsById.get(pdf.dataset.openPdf), pdf.dataset.page);

    const note = event.target.closest("[data-open-note]");
    if (note) {
      const doc = docsById.get(note.dataset.openNote);
      if (doc?.notaUri) window.open(doc.notaUri, "_blank", "noopener");
      return;
    }

    const official = event.target.closest("[data-open-official]");
    if (official) {
      const url = officialUrl(docsById.get(official.dataset.openOfficial));
      if (url) window.open(url, "_blank", "noopener");
      return;
    }

    const copyPath = event.target.closest("[data-copy-path]");
    if (copyPath) return copyText(docsById.get(copyPath.dataset.copyPath)?.pdf, "Caminho copiado.");

    const copyCitation = event.target.closest("[data-copy-citation]");
    if (copyCitation) {
      const doc = docsById.get(copyCitation.dataset.copyCitation);
      const format = copyCitation.dataset.format || "bibtex";
      const value = window.Citacoes?.format ? window.Citacoes.format(doc, format) : doc?.bibtex;
      return copyText(value, `Citação ${format.toLocaleUpperCase("pt-BR")} copiada.`);
    }

    const clear = event.target.closest("[data-clear-filters]");
    if (clear) {
      state.query = "";
      state.collectionOnly = "";
      Object.keys(state.filters).forEach(key => { state.filters[key] = ""; });
      state.limit = 60;
      return render();
    }

    if (event.target.closest("[data-load-more]")) {
      state.limit += 60;
      return render();
    }

    const openCollection = event.target.closest("[data-open-collection]");
    if (openCollection) {
      const group = collectionDefs.find(item => item.id === openCollection.dataset.openCollection);
      state.filters.subject = "";
      state.query = group ? "" : state.query;
      state.view = "catalog";
      const matching = docs.filter(doc => collectionFor(doc) === openCollection.dataset.openCollection);
      state.selectedId = matching[0]?.id || state.selectedId;
      state.collectionOnly = openCollection.dataset.openCollection;
      return render();
    }

    const issue = event.target.closest("[data-quality-issue]");
    if (issue) {
      state.qualityIssue = issue.dataset.qualityIssue;
      return render();
    }

    const tab = event.target.closest("[data-detail-tab]");
    if (tab) {
      state.detailTab = tab.dataset.detailTab;
      render();
      window.requestAnimationFrame(() => app.querySelector(`[data-detail-tab="${state.detailTab}"]`)?.focus());
      return;
    }

    const tocAction = event.target.closest("[data-toc-action]");
    if (tocAction) {
      document.querySelectorAll(".toc-tree details").forEach(item => { item.open = tocAction.dataset.tocAction === "expand"; });
      return;
    }

    const openNetwork = event.target.closest("[data-open-network]");
    if (openNetwork) {
      state.networkId = openNetwork.dataset.openNetwork;
      state.selectedId = state.networkId;
      state.networkTargetId = "";
      return setView("network");
    }

    const target = event.target.closest("[data-network-target]");
    if (target) {
      state.networkTargetId = target.dataset.networkTarget;
      return render();
    }

    const filterLink = event.target.closest("[data-filter-link]");
    if (filterLink) {
      state.filters[filterLink.dataset.filterLink] = filterLink.dataset.value;
      return setView("catalog");
    }
  });

  app.addEventListener("change", event => {
    const filter = event.target.closest("[data-filter]");
    if (filter) {
      state.filters[filter.dataset.filter] = filter.value;
      state.limit = 60;
      if (state.view === "text") return render();
      return render();
    }

    const sort = event.target.closest("[data-sort]");
    if (sort) {
      state.sort = sort.value;
      return render();
    }

    const subject = event.target.closest("[data-collection-subject]");
    if (subject) {
      state.filters.subject = subject.checked ? subject.dataset.collectionSubject : "";
      return render();
    }

    const type = event.target.closest("[data-collection-type]");
    if (type) {
      state.filters.type = type.checked ? type.dataset.collectionType : "";
      return render();
    }

    const networkFilter = event.target.closest("[data-network-filter]");
    if (networkFilter) {
      state.networkFilters[networkFilter.dataset.networkFilter] = networkFilter.checked;
      state.networkTargetId = "";
      return render();
    }
  });

  app.addEventListener("submit", event => {
    const form = event.target.closest("[data-search-form]");
    if (!form) return;
    event.preventDefault();
    state.query = form.querySelector("input[type='search']")?.value.trim() || "";
    state.collectionOnly = "";
    state.limit = 60;
    if (state.searchMode === "content" || state.view === "text") return runTextSearch();
    state.view = "catalog";
    render();
  });

  app.addEventListener("input", event => {
    const networkSearch = event.target.closest("[data-network-search]");
    if (!networkSearch) return;
    const value = normalize(networkSearch.value);
    app.querySelectorAll(".network-list-button").forEach(button => {
      button.hidden = value && !normalize(button.textContent).includes(value);
    });
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.menuOpen) {
      state.menuOpen = false;
      render();
      window.requestAnimationFrame(() => app.querySelector("[data-menu]")?.focus());
      return;
    }
    if (event.key === "Escape" && state.previewOpen) {
      state.previewOpen = false;
      render();
      window.requestAnimationFrame(() => app.querySelector(`[data-select-doc="${state.selectedId}"]`)?.focus());
      return;
    }
    const tab = event.target.closest?.("[data-detail-tab]");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = ["toc", "references", "related", "relations"];
    const current = Math.max(0, tabs.indexOf(state.detailTab));
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    state.detailTab = tabs[next];
    render();
    window.requestAnimationFrame(() => app.querySelector(`[data-detail-tab="${state.detailTab}"]`)?.focus());
  });

  document.addEventListener("click", event => {
    if (!state.menuOpen || event.target.closest?.("[data-menu], #main-nav")) return;
    state.menuOpen = false;
    render();
  });

  window.MeuAcervoV2 = { state, render, setView, runTextSearch };
  render();
})();
