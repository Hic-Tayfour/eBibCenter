(() => {
  "use strict";

  const app = document.querySelector("#app");
  const onlineMode = window.MEU_ACERVO_ONLINE === true;
  const docs = Array.isArray(window.CATALOGO) ? window.CATALOGO : [];
  const meta = window.CATALOGO_META || {};
  const textMeta = onlineMode ? null : window.CATALOGO_INDICE_META || null;
  const citationData = window.REDES_CITACOES?.global || { nodes: [], edges: [], extraction: [] };
  const affinityData = window.MAPA_AFINIDADE || { nodes: [], edges: [], extraction: [] };
  const docsById = new Map(docs.map(doc => [doc.id, doc]));
  const citationExtraction = new Map((citationData.extraction || []).map(item => [item.id, item]));
  const affinityExtraction = new Map((affinityData.extraction || []).map(item => [item.id, item]));
  const loadedScripts = new Map();
  let toastTimer;

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
      code: "",
      codeOrigin: "",
    },
    collectionOnly: "",
    sort: "title",
    layout: "list",
    limit: 60,
    selectedId: preferred?.id || "",
    previewOpen: false,
    previewCollapsed: false,
    filtersOpen: false,
    detailTab: "toc",
    qualityIssue: "all",
    textResults: [],
    textLimit: 30,
    textGeneration: 0,
    textQuery: "",
    detailOrigin: null,
    textStatus: "Digite uma expressão para pesquisar dentro dos PDFs indexados.",
    textLoading: false,
    networkId: preferred?.id || "",
    networkTargetId: "",
    networkQuery: "",
    networkSidebarOpen: false,
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
      code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/>',
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
      `${typeLabel(doc.tipo)} de ${canonicalTopic(doc.assunto) || "assunto não informado"}`,
      doc.subassunto ? `subassunto ${canonicalTopic(doc.subassunto)}` : "",
      doc.paginas ? `${doc.paginas} páginas` : "",
      doc.sumario?.length ? `${doc.sumario.length} seções transcritas no sumário` : "sem sumário transcrito",
    ].filter(Boolean);
    return `${facts.join(" · ")}.`;
  }

  function displayTags(doc, limit = 5) {
    const fromTags = (doc.tags || []).flatMap(tag => String(tag).split(/[\/]/g));
    const aliases = {
      alglin: "Álgebra Linear",
      mcmc: "MCMC",
      ptbr: "Português Brasileiro",
      "visualizacao de dados": "Visualização de Dados",
      "comunicacao cientifica": "Comunicação Científica",
    };
    return unique(fromTags.map(item => aliases[normalize(item)] || canonicalTopic(item.replace(/-/g, " "))))
      .filter(item => normalize(item) !== normalize(canonicalTopic(doc.assunto)) && normalize(item) !== normalize(canonicalTopic(doc.subassunto)))
      .slice(0, limit);
  }

  function canonicalTopic(value) {
    const aliases = {
      ia: "Inteligência Artificial",
      "inteligencia artificial": "Inteligência Artificial",
      "artificial intelligence": "Inteligência Artificial",
      ml: "Aprendizado de Máquina",
      "machine learning": "Aprendizado de Máquina",
      "aprendizado de maquina": "Aprendizado de Máquina",
      "aprendizagem de maquina": "Aprendizado de Máquina",
      bayesian: "Bayesiano",
      bayesiano: "Bayesiano",
      bayesiana: "Bayesiano",
      "bayesian statistics": "Estatística Bayesiana",
      "estatistica bayesiana": "Estatística Bayesiana",
    };
    return aliases[normalize(value)] || String(value || "").trim();
  }

  function expandSearchQuery(value) {
    return normalize(value)
      .replace(/\b(?:inteligencia artificial|artificial intelligence|ia)\b/g, "inteligencia artificial")
      .replace(/\b(?:aprendizagem de maquina|aprendizado de maquina|machine learning|ml)\b/g, "aprendizado de maquina")
      .replace(/\b(?:bayesian|bayesiano|bayesiana)\b/g, "bayesiano");
  }

  function searchableText(doc) {
    const text = [doc.titulo, ...(doc.autores || []), doc.assunto, doc.subassunto,
      ...(doc.tags || []), doc.publicacao, ...(doc.sumario || []).map(item => item.titulo)].join(" ");
    return `${normalize(text)} ${expandSearchQuery(text)}`;
  }

  function docIdentity(doc) {
    const duplicates = docs.filter(item => normalize(item.titulo) === normalize(doc.titulo));
    if (duplicates.length < 2) return "";
    const identity = item => {
      const author = Array.isArray(item.autores) ? item.autores[0] : item.autores;
      const edition = item.edicao || item.edition || String(item.bibtex || "").match(/\bedition\s*=\s*\{([^}]+)\}/i)?.[1];
      return [author ? truncate(author, 28) : "Autor não informado", item.ano,
        edition ? `edição ${edition}` : ""].filter(Boolean).join(" · ");
    };
    const label = identity(doc);
    return duplicates.filter(item => identity(item) === label).length > 1
      ? `${label} · registro ${String(doc.id).slice(-6)}` : label;
  }

  function codeResources(doc) {
    const resources = window.FONTES_CODIGO?.[doc?.bibId];
    return Array.isArray(resources) ? resources.filter(item => /^https?:\/\//i.test(item.url || "")) : [];
  }

  function codeStatus(doc) {
    return codeResources(doc).length ? "registered" : "pending";
  }

  function codeOrigin(item) {
    const type = normalize(item.tipo);
    if (/indice/.test(type)) return "index";
    if (/terceiros|comunidade/.test(type)) return "community";
    if (/autor|oficia|editora/.test(type)) return "author";
    return "associated";
  }

  function codeOriginOptions() {
    return [
      { value: "author", label: "Autores / oficial" },
      { value: "community", label: "Comunidade / terceiros" },
      { value: "index", label: "Índice de descoberta" },
      { value: "associated", label: "Recurso associado à obra" },
    ];
  }

  function matchesCodeFilters(doc) {
    if (state.filters.code && codeStatus(doc) !== state.filters.code) return false;
    return !state.filters.codeOrigin || codeResources(doc).some(item => codeOrigin(item) === state.filters.codeOrigin);
  }

  function codeIndicator(doc) {
    const resources = codeResources(doc);
    if (!resources.length) return "";
    const indexesOnly = resources.every(item => codeOrigin(item) === "index");
    return `<span class="code-indicator" title="${resources.length} recurso(s) cadastrado(s); consulte a origem e a evidência na ficha">${icon("code")}${indexesOnly ? "Índice de código" : "Recursos de código"}</span>`;
  }

  function activeView() {
    if (state.view === "detail") return state.detailOrigin?.view === "text" ? "catalog" : state.detailOrigin?.view || "catalog";
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
          ${onlineMode ? "" : navButton("quality", "quality", "Qualidade", current)}
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
    return `<button type="button" data-view="${view}" aria-label="${escapeHtml(label)}" ${current === view ? 'aria-current="page"' : ""}>${icon(iconName)}<span>${label}</span></button>`;
  }

  function renderModeStrip(extra = "") {
    return `
      <section class="mode-strip${onlineMode ? " mode-strip--online" : ""}" aria-label="Modo de exploração">
        <div class="mode-switch">
          <button type="button" data-search-mode="metadata" aria-pressed="${state.view !== "network" && state.searchMode === "metadata"}">${icon("document")} Metadados</button>
          ${onlineMode ? "" : `<button type="button" data-search-mode="content" aria-pressed="${state.view !== "network" && state.searchMode === "content"}">${icon("text")} Conteúdo completo</button>`}
          ${extra}
        </div>
        <p class="mode-strip__quote">“Livros organizam ideias. Ideias constroem caminhos.”</p>
      </section>`;
  }

  function captureUiContext() {
    const active = document.activeElement;
    let attributes = active && app.contains(active)
      ? [...active.attributes].filter(item => item.name === "id" || item.name.startsWith("data-"))
      : [];
    if (!attributes.length && active && app.contains(active) && active.hasAttribute("aria-label")) {
      attributes = [...active.attributes].filter(item => item.name === "aria-label");
    }
    const selector = attributes.length ? active.tagName.toLowerCase() + attributes.map(item =>
      `[${item.name}="${String(item.value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
    ).join("") : "";
    return {
      top: window.scrollY || 0,
      left: window.scrollX || 0,
      panels: [".catalog-results", ".quick-preview", ".detail-main", ".detail-rail", ".network-sidebar", ".network-canvas", ".network-detail"].map(selector => {
        const panel = app.querySelector(selector);
        return { selector, top: panel?.scrollTop || 0, left: panel?.scrollLeft || 0 };
      }),
      toc: {
        open: [...app.querySelectorAll(".toc-tree details")].map(item => item.open),
        wasOpen: [...app.querySelectorAll(".toc-tree details")].map(item => item.dataset.tocWasOpen),
        searchActive: app.querySelector(".toc-tree")?.dataset.searchActive === "true",
        query: app.querySelector("[data-toc-search]")?.value || "",
      },
      citations: [...app.querySelectorAll(".citation-card[data-expanded='true'] [data-expand-citation]")].map(button => button.getAttribute("aria-controls")),
      focus: selector ? {
        selector,
        index: [...app.querySelectorAll(selector)].indexOf(active),
        start: active.selectionStart,
        end: active.selectionEnd,
        value: active.id === "global-query" || active.hasAttribute("data-toc-search") ? active.value : null,
      } : null,
    };
  }

  function restoreUiContext(context) {
    if (!context) return;
    (context.citations || []).forEach(id => {
      const button = app.querySelector(`[data-expand-citation][aria-controls="${id}"]`);
      if (!button) return;
      button.setAttribute("aria-expanded", "true");
      button.closest(".citation-card").dataset.expanded = "true";
      button.textContent = `Recolher ${button.closest(".citation-card").querySelector("h3").textContent}`;
    });
    context.panels.forEach(saved => {
      const panel = app.querySelector(saved.selector);
      if (panel) {
        panel.scrollTop = saved.top;
        panel.scrollLeft = saved.left;
      }
    });
    if (context.toc) {
      [...app.querySelectorAll(".toc-tree details")].forEach((item, index) => {
        if (index < context.toc.open.length) item.open = context.toc.open[index];
        if (context.toc.wasOpen?.[index] !== undefined) item.dataset.tocWasOpen = context.toc.wasOpen[index];
      });
      const tree = app.querySelector(".toc-tree");
      if (tree && context.toc.searchActive) tree.dataset.searchActive = "true";
      const search = app.querySelector("[data-toc-search]");
      if (search && context.toc.query) {
        search.value = context.toc.query;
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    window.scrollTo({ top: context.top, left: context.left });
    const saved = context.focus;
    const control = saved ? app.querySelectorAll(saved.selector)[Math.max(0, saved.index)]
      || app.querySelector("[data-more-filters], #global-query, #main") : null;
    if (!control) return;
    if (saved.value !== null && (control.id === "global-query" || control.hasAttribute("data-toc-search"))) control.value = saved.value;
    control.focus({ preventScroll: true });
    if (saved.start !== null && saved.start !== undefined && control.setSelectionRange && (control.type === "search" || control.type === "text" || control.tagName === "TEXTAREA")) {
      control.setSelectionRange(saved.start, saved.end);
    }
  }

  function render({ preserve = true } = {}) {
    if (onlineMode && ["text", "quality"].includes(state.view)) {
      state.view = "catalog";
      state.searchMode = "metadata";
      state.detailOrigin = null;
    }
    const context = preserve && app.dataset.renderedView === state.view ? captureUiContext() : null;
    app.innerHTML = `${renderHeader()}<main id="main" class="app-main" tabindex="-1">${renderView()}</main>${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ""}`;
    app.dataset.renderedView = state.view;
    updateSiteHeaderHeight();
    restoreUiContext(context);
    if (state.view === "text" && !state.textLoading) void loadVisibleTextSnippets();
  }

  function updateSiteHeaderHeight() {
    const height = app.querySelector(".site-header")?.offsetHeight;
    if (height) document.documentElement.style.setProperty("--site-header-height", `${height}px`);
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
    return unique(docs.map(doc => ["assunto", "subassunto"].includes(field) ? canonicalTopic(doc[field]) : String(doc[field] || "").trim()))
      .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  }

  function selectOptions(values, selected, emptyLabel) {
    return `<option value="">${emptyLabel}</option>${values.map(value => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
  }

  function renderFilterBar(count, textSearch = false) {
    return `
      <section class="filter-bar" aria-label="Filtros do catálogo">
        ${filterSelect("type", filterValues("tipo"), "Tipo")}
        ${filterSelect("subject", filterValues("assunto"), "Assunto")}
        <button class="more-filters secondary-action" type="button" data-more-filters aria-expanded="${state.filtersOpen}" aria-controls="extra-filters">${icon("filter")} Mais filtros</button>
        <strong class="filter-count" role="status">${count} ${textSearch ? "resultados" : count === 1 ? "documento" : "documentos"}</strong>
        ${textSearch || state.view !== "catalog" || !count ? "" : `<button class="preview-toggle secondary-action" type="button" data-toggle-preview aria-expanded="${!state.previewCollapsed}" aria-controls="quick-preview">${icon("document")} ${state.previewCollapsed ? "Mostrar prévia" : "Recolher prévia"}</button><div class="view-toggle" role="group" aria-label="Modo de visualização"><button type="button" data-layout="list" aria-pressed="${state.layout === "list"}" aria-label="Lista">${icon("list")}</button><button type="button" data-layout="grid" aria-pressed="${state.layout === "grid"}" aria-label="Grade">${icon("grid")}</button></div>`}
        <label class="sort-control"><span>Ordenar por</span>${textSearch ? `<select disabled><option>Relevância</option></select>` : `<select data-sort><option value="title" ${state.sort === "title" ? "selected" : ""}>Título (A–Z)</option><option value="author" ${state.sort === "author" ? "selected" : ""}>Autor</option><option value="year" ${state.sort === "year" ? "selected" : ""}>Ano recente</option></select>`}</label>
        <div id="extra-filters" class="filter-panel" ${state.filtersOpen ? "" : "hidden"}>
          ${filterSelect("subsubject", filterValues("subassunto"), "Subassunto")}
          ${filterSelect("year", filterValues("ano").sort((a, b) => b.localeCompare(a, "pt-BR", { numeric: true })), "Ano")}
          ${choiceFilter("summary", "Sumário", [["yes", "Com sumário"], ["no", "Sem sumário"]])}
          ${choiceFilter("online", "Leitura oficial", [["yes", "Disponível online"], ["no", onlineMode ? "Sem link oficial cadastrado" : "Somente local"]])}
          ${choiceFilter("quality", onlineMode ? "Bibliografia" : "Qualidade", [["verified", "Bibliografia verificada"], ["pending", onlineMode ? "Bibliografia pendente" : "Revisão pendente"]])}
          ${choiceFilter("code", "Código e implementações", [["registered", "Com código/recursos cadastrados"], ["pending", "Sem pesquisa registrada"]])}
          ${choiceFilter("codeOrigin", "Origem do código", codeOriginOptions().map(item => [item.value, item.label]))}
        </div>
        ${renderActiveFilters()}
      </section>`;
  }

  function choiceFilter(name, label, choices) {
    return `<label class="filter-control"><span class="sr-only">${label}</span><select data-filter="${name}"><option value="">${label}</option>${choices.map(([value, text]) => `<option value="${escapeHtml(value)}" ${state.filters[name] === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
  }

  function renderActiveFilters() {
    const labels = { type: "Tipo", subject: "Assunto", subsubject: "Subassunto", year: "Ano", summary: "Sumário", online: "Leitura oficial", quality: onlineMode ? "Bibliografia" : "Qualidade", code: "Código", codeOrigin: "Origem" };
    const values = { summary: {yes: "Com sumário", no: "Sem sumário"}, online: {yes: "Online", no: onlineMode ? "Sem link cadastrado" : "Somente local"}, quality: {verified: "Verificada", pending: "Pendente"}, code: {registered: "Recursos cadastrados", pending: "Sem pesquisa registrada"}, codeOrigin: Object.fromEntries(codeOriginOptions().map(item => [item.value, item.label])) };
    const chips = Object.entries(state.filters).filter(([, value]) => value).map(([key, value]) => {
      const text = values[key]?.[value] || (["subject", "subsubject"].includes(key) ? canonicalTopic(value) : value);
      return `<button type="button" class="filter-chip" data-remove-filter="${key}" aria-label="Remover filtro ${labels[key]}: ${escapeHtml(text)}">${labels[key]}: ${escapeHtml(text)} <span aria-hidden="true">×</span></button>`;
    });
    if (state.query) chips.unshift(`<button type="button" class="filter-chip" data-remove-filter="query" aria-label="Remover busca">Busca: ${escapeHtml(state.query)} <span aria-hidden="true">×</span></button>`);
    if (state.collectionOnly) chips.push(`<button type="button" class="filter-chip" data-remove-filter="collection" aria-label="Remover filtro de coleção">Coleção: ${escapeHtml(collectionDefs.find(group => group.id === state.collectionOnly)?.title || "Outros campos")} <span aria-hidden="true">×</span></button>`);
    return chips.length ? `<div class="active-filters" aria-label="Filtros ativos">${chips.join("")}<button class="clear-filters" type="button" data-clear-filters>Limpar filtros</button></div>` : "";
  }

  function filterSelect(name, values, label, className = "") {
    const selected = ["subject", "subsubject"].includes(name) ? canonicalTopic(state.filters[name]) : state.filters[name];
    return `<label class="filter-control ${className}"><span class="sr-only">${label}</span><select data-filter="${name}">${selectOptions(values, selected, label)}</select></label>`;
  }

  function hasFilters() {
    return Boolean(state.query || state.collectionOnly || Object.values(state.filters).some(Boolean));
  }

  function matchesDocumentFilters(doc) {
    if (state.collectionOnly && collectionFor(doc) !== state.collectionOnly) return false;
    if (state.filters.type && doc.tipo !== state.filters.type) return false;
    if (state.filters.subject && canonicalTopic(doc.assunto) !== canonicalTopic(state.filters.subject)) return false;
    if (state.filters.subsubject && canonicalTopic(doc.subassunto) !== canonicalTopic(state.filters.subsubject)) return false;
    if (state.filters.year && String(doc.ano || "") !== state.filters.year) return false;
    if (state.filters.summary === "yes" && !doc.sumario?.length) return false;
    if (state.filters.summary === "no" && doc.sumario?.length) return false;
    if (state.filters.online === "yes" && !isOnline(doc)) return false;
    if (state.filters.online === "no" && isOnline(doc)) return false;
    if (state.filters.quality === "verified" && doc.bibStatus !== "verificado") return false;
    if (state.filters.quality === "pending" && doc.bibStatus === "verificado") return false;
    return matchesCodeFilters(doc);
  }

  function filteredDocs() {
    const query = expandSearchQuery(state.query);
    const terms = query.split(/\s+/).filter(Boolean);
    const result = docs.filter(doc => {
      if (!matchesDocumentFilters(doc)) return false;
      if (!terms.length) return true;
      const searchable = searchableText(doc);
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
    if (state.detailOrigin) {
      const sequence = state.detailOrigin.ids.map(id => docsById.get(id)).filter(Boolean);
      const current = docsById.get(currentId);
      return sequence.some(doc => doc.id === currentId) ? sequence : current ? [current, ...sequence] : sequence;
    }
    const result = filteredDocs();
    return result.some(doc => doc.id === currentId) ? result : sortedDocs(docs);
  }

  function captureDetailOrigin(control) {
    if (state.view === "detail") return;
    const collection = control?.closest("[data-collection-id]")?.dataset.collectionId;
    const sequence = state.view === "text" ? filteredTextResults().map(hit => docsById.get(hit.id)).filter(Boolean)
      : state.view === "quality" ? qualityDocs()
      : state.view === "network" ? networkSequence(state.networkId)
      : collection ? filteredDocs().filter(doc => collectionFor(doc) === collection)
      : filteredDocs();
    state.detailOrigin = {
      view: state.view,
      ids: sequence.map(doc => doc.id),
      snapshot: {
        query: state.query, searchMode: state.searchMode,
        filters: JSON.parse(JSON.stringify(state.filters)),
        collectionOnly: state.collectionOnly, qualityIssue: state.qualityIssue,
        sort: state.sort, layout: state.layout, limit: state.limit, textLimit: state.textLimit,
        selectedId: control?.dataset.openDetail || state.selectedId, previewOpen: state.previewOpen,
        previewCollapsed: state.previewCollapsed, filtersOpen: state.filtersOpen,
        networkId: state.networkId, networkTargetId: state.networkTargetId, networkQuery: state.networkQuery,
      },
      ui: captureUiContext(),
    };
  }

  function returnToDetailOrigin() {
    const origin = state.detailOrigin;
    if (!origin) return setView("catalog");
    Object.assign(state, origin.snapshot);
    state.view = origin.view;
    state.detailOrigin = null;
    render({ preserve: false });
    restoreUiContext(origin.ui);
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
    const selectedIndex = result.findIndex(doc => doc.id === state.selectedId);
    if (selectedIndex >= state.limit) state.limit = Math.ceil((selectedIndex + 1) / 60) * 60;
    const visible = result.slice(0, state.limit);
    const selected = result[selectedIndex] || visible[0] || null;
    if (selected && state.selectedId !== selected.id) state.selectedId = selected.id;
    return `${renderModeStrip()}${renderFilterBar(result.length)}
      <section class="catalog-workspace" data-preview-collapsed="${state.previewCollapsed || !selected}">
        <div class="catalog-results" data-layout="${state.layout}">
          <div class="list-head" aria-hidden="true"><span>Documento</span><span>Tipo</span><span>Assunto</span><span>Sumário</span><span>Leitura oficial</span><span>Relações</span><span>Ficha</span></div>
          <div class="catalog-list">${visible.length ? visible.map(renderCatalogRow).join("") : renderEmpty("Nenhum documento encontrado", "Remova um filtro ou use termos mais amplos.")}</div>
          ${visible.length < result.length ? `<button class="load-more" type="button" data-load-more>Carregar mais ${Math.min(60, result.length - visible.length)}</button>` : ""}
        </div>
        ${selected ? renderQuickPreview(selected, result.findIndex(doc => doc.id === selected.id) + 1, result.length) : ""}
      </section>`;
  }

  function renderCatalogRow(doc) {
    const relations = relationCount(doc.id);
    return `<div class="catalog-row" data-selected="${doc.id === state.selectedId}">
      <button class="catalog-row__select" type="button" data-select-doc="${escapeHtml(doc.id)}" aria-pressed="${doc.id === state.selectedId}" aria-label="Selecionar ${escapeHtml(doc.titulo)} para prévia"></button>
      <div class="document-cell">${coverMarkup(doc)}<div><h3 title="${escapeHtml(doc.titulo)}">${escapeHtml(doc.titulo)}</h3><p>${doc.ano ? `${escapeHtml(doc.ano)} · ` : ""}${escapeHtml((doc.autores || []).join("; ") || "Autoria não informada")}</p>${codeIndicator(doc)}</div></div>
      <span class="type-badge"><span class="sr-only">Tipo: </span>${escapeHtml(typeLabel(doc.tipo))}</span>
      <span class="cell-main"><span class="sr-only">Assunto: </span>${escapeHtml(canonicalTopic(doc.assunto) || "Não informado")}<small><span class="sr-only">Subassunto: </span>${escapeHtml(canonicalTopic(doc.subassunto))}</small></span>
      <span class="status-chip ${doc.sumario?.length ? "status-chip--ok" : "status-chip--muted"}"><span class="sr-only">Sumário: </span>${icon("toc")} ${doc.sumario?.length ? "Sim" : "Não"}</span>
      <span class="status-chip ${isOnline(doc) ? "status-chip--ok" : "status-chip--muted"}"><span class="sr-only">Leitura oficial: </span>${isOnline(doc) ? icon("online") : "○"} ${isOnline(doc) ? "Sim" : "Não"}</span>
      <span class="status-chip ${relations ? "status-chip--ok" : "status-chip--muted"}"><span class="sr-only">Relações: </span>${icon("relations")} ${relations}</span>
      <button class="catalog-row__open" type="button" data-open-detail="${escapeHtml(doc.id)}" aria-label="Abrir ficha de ${escapeHtml(doc.titulo)}">Abrir ficha <span aria-hidden="true">→</span></button>
    </div>`;
  }

  function renderQuickPreview(doc, index, total) {
    return `<aside id="quick-preview" class="quick-preview" data-open="${state.previewOpen}" aria-label="Prévia rápida">
      <header class="preview-heading"><h2>${icon("document")} Prévia rápida</h2><span>${Math.max(1, index)} de ${total} <button class="icon-button" type="button" data-preview-step="-1" aria-label="Documento anterior">‹</button><button class="icon-button" type="button" data-preview-step="1" aria-label="Próximo documento">›</button><button class="icon-button" type="button" data-close-preview aria-label="Fechar prévia">${icon("close")}</button></span></header>
      <div class="preview-document">${coverMarkup(doc, "preview-document__cover")}<div><h2>${escapeHtml(doc.titulo)}</h2><dl class="preview-meta"><dt>Tipo</dt><dd>${escapeHtml(typeLabel(doc.tipo))}</dd><dt>Assunto</dt><dd>${escapeHtml(canonicalTopic(doc.assunto) || "Não informado")}</dd><dt>Subassunto</dt><dd>${escapeHtml(canonicalTopic(doc.subassunto) || "Não informado")}</dd><dt>Ano</dt><dd>${escapeHtml(doc.ano || "Não informado")}</dd></dl><div class="tag-list">${displayTags(doc).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div></div></div>
      <div class="preview-statuses">
        <div class="preview-status">${icon("toc")}<div><strong>Sumário</strong><span>${doc.sumario?.length ? `${doc.sumario.length} seções` : "Não disponível"}</span></div></div>
        <div class="preview-status">${icon("online")}<div><strong>Leitura oficial</strong><span>${isOnline(doc) ? "Disponível" : "Não registrada"}</span></div></div>
      </div>
      <p class="preview-code">${codeIndicator(doc) || "Código e implementações: sem pesquisa registrada."}</p>
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
    return [...postings[0].keys()].filter(id => docsById.has(id) && postings.every(item => item.has(id))).map(id => {
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
    if (onlineMode) return setView("catalog");
    state.view = "text";
    state.searchMode = "content";
    const generation = ++state.textGeneration;
    state.textQuery = state.query;
    state.textLimit = 30;
    state.textResults = [];
    state.textLoading = false;
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
    render({ preserve: false });
    app.querySelector("#global-query")?.focus({ preventScroll: true });
    try {
      const shards = await Promise.all(terms.map(term => loadShard(shardKey(term))));
      if (generation !== state.textGeneration) return;
      const hits = textCandidates(terms, shards);
      state.textResults = hits.map(hit => ({ ...hit, page: hit.pages[0] || 1, terms }));
      state.textStatus = hits.length
        ? `${hits.length} ${hits.length === 1 ? "documento encontrado" : "documentos encontrados"} · ${hits.reduce((sum, hit) => sum + hit.pages.length, 0)} páginas candidatas. A prévia dos trechos é carregada conforme a exibição.`
        : "Nenhum documento contém todos os termos pesquisados.";
    } catch (error) {
      if (generation !== state.textGeneration) return;
      state.textResults = [];
      state.textStatus = `Falha ao consultar o índice local: ${error.message}`;
    } finally {
      if (generation !== state.textGeneration) return;
      state.textLoading = false;
      if (state.view === "text") render();
    }
  }

  async function loadVisibleTextSnippets() {
    const generation = state.textGeneration;
    const missing = filteredTextResults().slice(0, state.textLimit)
      .filter(hit => hit.snippet === undefined && !hit.loadingSnippet);
    if (!missing.length) return;
    missing.forEach(hit => { hit.loadingSnippet = true; });
    await Promise.all(missing.map(async hit => {
      try {
        const text = await loadTextDocument(hit.id);
        if (generation === state.textGeneration) hit.snippet = snippet(text.pages?.[hit.page - 1] || "", hit.terms);
      } catch {
        if (generation === state.textGeneration) hit.snippet = "A prévia deste trecho não pôde ser carregada. Abra o PDF na página indicada.";
      } finally {
        hit.loadingSnippet = false;
      }
    }));
    if (generation === state.textGeneration && state.view === "text") render();
  }

  function clearTextSearch() {
    state.textGeneration++;
    state.textResults = [];
    state.textLoading = false;
    state.textQuery = "";
    state.textLimit = 30;
    state.textStatus = "Digite uma expressão para pesquisar dentro dos PDFs indexados.";
  }

  function renderTextSearch() {
    const filtered = filteredTextResults();
    return `${renderModeStrip()}
      ${renderFilterBar(filtered.length, true)}
      <section class="text-search-layout">
        <div class="text-results">
          <header class="text-results__head"><h2>Resultados no conteúdo completo</h2><p class="text-status" role="status">${escapeHtml(state.textStatus)}</p>${!state.textLoading && state.textResults.length ? `<p class="text-status">Exibindo ${Math.min(state.textLimit, filtered.length)} de ${filtered.length} resultados após os filtros (${state.textResults.length} no total).</p>` : ""}</header>
          ${state.textLoading ? renderEmpty("Consultando o índice", "A busca é executada somente nos arquivos locais indexados.") : renderTextRows()}
          ${!state.textLoading && filtered.length > state.textLimit ? `<button class="load-more" type="button" data-load-more-text>Carregar mais ${Math.min(30, filtered.length - state.textLimit)} resultados</button>` : ""}
        </div>
        <aside class="text-help">
          <h2>Sobre esta busca</h2>
          <div class="help-card"><h3>${icon("search")} Conteúdo completo</h3><p>Pesquisa no texto extraído de ${textMeta?.indexados || 0} PDFs, incluindo capítulos, tabelas, figuras e referências.</p></div>
          <div class="help-card"><h3>Termo pesquisado</h3><p>${state.textQuery ? `“${escapeHtml(state.textQuery)}”` : "Nenhum termo informado"}</p></div>
          <div class="help-card"><h3>Dicas rápidas</h3><ul><li>Use expressões específicas.</li><li>Combine termos que devem aparecer no mesmo documento.</li><li>Abra a ficha para consultar metadados e relações.</li></ul></div>
        </aside>
      </section>`;
  }

  function renderTextRows() {
    if (!state.textResults.length) return renderEmpty("Nenhum trecho para exibir", state.textStatus);
    const filtered = filteredTextResults();
    if (!filtered.length) return renderEmpty("Nenhum trecho corresponde aos filtros", "Limpe um filtro ou escolha valores mais amplos.");
    return filtered.slice(0, state.textLimit).map(hit => {
      const doc = docsById.get(hit.id);
      return `<article class="text-row">
        <div class="document-cell">${coverMarkup(doc)}<div><h3>${escapeHtml(doc.titulo)}</h3><p>${escapeHtml((doc.autores || []).join("; ") || "Autoria não informada")}</p></div></div>
        <p class="text-snippet">${hit.snippet === undefined ? "Carregando prévia do trecho…" : highlight(hit.snippet, hit.terms)}</p>
        <p class="text-pages">Página ${hit.page}${hit.pages.length > 1 ? `<br>e mais ${hit.pages.length - 1}` : ""}</p>
        <div class="text-actions">${onlineMode ? "" : `<button class="primary-action" type="button" data-open-pdf="${escapeHtml(doc.id)}" data-page="${hit.page}">Ir ao trecho</button>`}<button class="secondary-action" type="button" data-open-detail="${escapeHtml(doc.id)}">Abrir ficha</button></div>
      </article>`;
    }).join("");
  }

  function filteredTextResults() {
    return state.textResults.filter(hit => {
      const doc = docsById.get(hit.id);
      if (!doc) return false;
      return matchesDocumentFilters(doc);
    });
  }

  /* Coleções */

  const collectionDefs = [
    {
      id: "statistics",
      title: "Estatística e Probabilidade",
      description: "Fundamentos teóricos, inferência, probabilidade e modelagem estatística.",
      match: /estat|probab|matem|infer/i,
      icon: "quality",
    },
    {
      id: "computing",
      title: "Computação e Ciência de Dados",
      description: "Algoritmos, programação, aprendizado de máquina e computação científica.",
      match: /machine|aprendizado|aprendizagem|program|computa|dados|intelig|deep|islr|torch|python|redes/i,
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
    const subject = canonicalTopic(doc.assunto);
    const primary = collectionDefs.find(group => group.match.test(subject));
    if (primary) return primary.id;
    const text = `${canonicalTopic(doc.subassunto)} ${displayTags(doc, 100).join(" ")}`;
    return collectionDefs.find(group => group.match.test(text))?.id || "other";
  }

  function renderCollections() {
    const result = filteredDocs();
    const groups = collectionDefs.map(def => ({ ...def, docs: result.filter(doc => collectionFor(doc) === def.id) }));
    const assigned = new Set(groups.flatMap(group => group.docs.map(doc => doc.id)));
    const otherDocs = result.filter(doc => !assigned.has(doc.id));
    if (otherDocs.length) groups.push({ id: "other", title: "Outros campos", description: "Obras de áreas não abrangidas pelas coleções temáticas principais.", icon: "catalog", docs: otherDocs });
    const subjects = unique(docs.map(doc => canonicalTopic(doc.assunto))).sort((a, b) => a.localeCompare(b, "pt-BR"));
    const cards = groups.map(renderCollectionCard).filter(Boolean).join("");
    return `${renderModeStrip()}${renderFilterBar(result.length)}
      <div class="page-shell">
        <div class="collections-layout">
          <aside class="facet-panel"><div class="facet-panel__head"><h2>Filtros</h2><button type="button" data-clear-filters>Limpar filtros</button></div><fieldset class="facet-group"><legend>Assunto — escolha um</legend><label><input type="radio" name="collection-subject" data-collection-subject="" ${!state.filters.subject ? "checked" : ""}>Todos os assuntos (${docs.length})</label>${subjects.map(subject => `<label><input type="radio" name="collection-subject" data-collection-subject="${escapeHtml(subject)}" ${canonicalTopic(state.filters.subject) === subject ? "checked" : ""}>${escapeHtml(subject)} (${docs.filter(doc => canonicalTopic(doc.assunto) === subject).length})</label>`).join("")}</fieldset><fieldset class="facet-group"><legend>Tipo — escolha um</legend><label><input type="radio" name="collection-type" data-collection-type="" ${!state.filters.type ? "checked" : ""}>Todos os tipos (${docs.length})</label>${filterValues("tipo").map(type => `<label><input type="radio" name="collection-type" data-collection-type="${escapeHtml(type)}" ${state.filters.type === type ? "checked" : ""}>${escapeHtml(typeLabel(type))} (${docs.filter(doc => doc.tipo === type).length})</label>`).join("")}</fieldset></aside>
          <section><header class="page-title"><div><h1>Coleções</h1><p>Explore o acervo por grandes áreas sustentadas pelos metadados reais.</p></div></header><div class="collection-grid">${cards || renderEmpty("Nenhuma coleção corresponde aos filtros", "Limpe um filtro ou escolha valores mais amplos.")}</div></section>
        </div>
      </div>`;
  }

  function renderCollectionCard(group) {
    const items = group.docs;
    const featured = items.filter(doc => doc.capa).slice(0, 2);
    if (!items.length) return "";
    return `<article class="collection-card" data-collection-id="${escapeHtml(group.id)}"><header class="collection-card__head"><span class="collection-card__icon">${icon(group.icon)}</span><div><h2>${escapeHtml(group.title)}</h2><p>${escapeHtml(group.description)}</p></div><span class="collection-card__count">${items.length} documentos</span></header><div class="collection-books">${featured.map(doc => `<button class="collection-book" type="button" data-open-detail="${escapeHtml(doc.id)}">${coverMarkup(doc)}<span><strong>${escapeHtml(doc.titulo)}</strong><span>${escapeHtml(canonicalTopic(doc.assunto))}<br>${escapeHtml(canonicalTopic(doc.subassunto))}</span><span class="type-badge">${escapeHtml(typeLabel(doc.tipo))}</span></span></button>`).join("")}</div><button class="collection-card__open" type="button" data-open-collection="${escapeHtml(group.id)}">Ver ${items.length} documentos →</button></article>`;
  }

  /* Qualidade */

  const qualityIssues = [
    { id: "bibliography", label: "Bibliografia pendente", icon: "document", priority: "Alta", test: doc => doc.bibStatus !== "verificado", note: "Metadados bibliográficos ainda precisam de verificação." },
    { id: "summary", label: "Sumário não cadastrado", icon: "toc", priority: "Média", coverage: true, test: doc => !doc.sumario?.length, note: "Nenhum sumário foi associado ao documento. Isso não significa que o PDF não tenha sumário." },
    { id: "read", label: "Falha de leitura do PDF", icon: "warning", priority: "Alta", test: doc => Boolean(doc.pdfStatus && doc.pdfStatus !== "ok"), note: "A última leitura registrada do PDF não foi concluída normalmente." },
    { id: "text", label: "Sem texto pesquisável", icon: "search", priority: "Alta", test: doc => textMeta?.statusPorDocumento?.[doc.id] === "sem_texto", note: "O índice registra ausência de texto extraível. Verifique se o PDF é uma imagem ou se precisa de OCR." },
    { id: "cover", label: "Sem miniatura", icon: "image", priority: "Média", test: doc => !doc.capa, note: "Nenhuma capa ou miniatura foi associada ao documento." },
    { id: "references", label: "Referências não detectadas", icon: "quote", priority: "Informativa", coverage: true, test: doc => citationExtraction.get(doc.id)?.status !== "ok", note: "A extração não confirmou referências rastreáveis. Não é possível concluir que o documento não possua bibliografia." },
    { id: "affinity", label: "Afinidade não calculada", icon: "relations", priority: "Informativa", coverage: true, test: doc => affinityExtraction.get(doc.id)?.status !== "rastreavel", note: "Não há referências extraídas suficientes para a comparação bibliográfica; isso é uma limitação do catálogo, não um defeito do documento." },
  ];

  function issuesFor(doc) {
    return qualityIssues.filter(issue => issue.test(doc));
  }

  function issueNeedsReview(issue, doc) {
    return !issue.coverage || (issue.id === "summary" && ["livro", "artigo"].includes(doc.tipo));
  }

  function issueObservation(issue, doc) {
    if (doc.tipo === "material" && ["summary", "references", "affinity"].includes(issue.id)) {
      return `Não avaliado para este material: ${issue.note} A ausência desse registro não entra, por si só, na fila padrão.`;
    }
    if (issue.id === "references" && citationExtraction.get(doc.id)?.status === "falha_leitura") {
      return "Houve falha na etapa de extração das referências. Isso não comprova uma falha de leitura atual do PDF nem ausência de bibliografia.";
    }
    if (issue.id === "affinity" && affinityExtraction.get(doc.id)?.status === "falha_leitura") {
      return "A etapa de extração para afinidade falhou. A comparação não foi avaliada; não se trata de um defeito confirmado do documento.";
    }
    return issue.note;
  }

  function reviewPriority(issue, doc) {
    return issueNeedsReview(issue, doc) ? issue.priority : "Informativa";
  }

  function qualityDocs() {
    return docs.filter(doc => {
      const issues = issuesFor(doc);
      return state.qualityIssue === "all" ? issues.some(issue => issueNeedsReview(issue, doc)) : issues.some(issue => issue.id === state.qualityIssue);
    });
  }

  function renderQuality() {
    const problemDocs = docs.filter(doc => issuesFor(doc).some(issue => issueNeedsReview(issue, doc)));
    const visible = qualityDocs();
    return `<section class="mode-strip" aria-label="Modo de revisão"><div class="mode-switch"><button type="button" aria-pressed="true">${icon("quality")} Qualidade do catálogo</button>${onlineMode ? "" : `<button type="button" data-search-mode="content" aria-pressed="false">${icon("text")} Conteúdo completo</button>`}</div><p class="mode-strip__quote">“Livros organizam ideias. Ideias constroem caminhos.”</p></section><div class="page-shell">
      <header class="page-title"><div><h1>Qualidade do catálogo</h1><p>Identifique documentos que precisam de atenção para manter o acervo completo e confiável.</p></div></header>
      <div class="quality-layout">
        <div>
          <div class="quality-cards">${qualityIssues.map(issue => {
            const count = docs.filter(issue.test).length;
            return `<button class="quality-card" type="button" data-quality-issue="${issue.id}" aria-pressed="${state.qualityIssue === issue.id}"><span class="quality-card__icon">${icon(issue.icon)}</span><span><span>${escapeHtml(issue.label)}</span><strong>${count}</strong><span>${issue.priority}</span></span></button>`;
          }).join("")}</div>
          <section><header class="page-title"><div><h2 class="review-title">${state.qualityIssue === "all" ? "Fila de revisão" : "Revisão e cobertura"}</h2><p>Um documento pode apresentar mais de um ponto de atenção.</p></div><strong>${visible.length} ${visible.length === 1 ? "documento" : "documentos"}</strong></header>
            ${state.qualityIssue !== "all" ? `<div class="review-filter-summary"><span role="status">Critério: ${escapeHtml(qualityIssues.find(issue => issue.id === state.qualityIssue)?.label || "Todos")}</span><button type="button" class="secondary-action" data-quality-issue="all">Voltar à fila padrão</button></div>` : ""}
            <p class="quality-policy">A fila padrão reúne pendências bibliográficas, falhas de leitura, ausência de texto ou miniatura e sumários não cadastrados em livros e artigos. Os cartões também contabilizam lacunas de cobertura. Referências, afinidade e sumário ausentes em materiais não são defeitos confirmados; consulte os filtros específicos para avaliá-los.</p>
            <div class="review-table"><div class="review-head"><span>Documento</span><span>Tipo</span><span>Pontos de atenção</span><span>Prioridade e observação</span><span>Abrir</span></div>${visible.length ? visible.map(renderReviewRow).join("") : renderEmpty("Nenhum documento nesta fila", "Não há registros que correspondam ao critério selecionado.")}</div>
          </section>
        </div>
        <aside class="quality-aside">
          <div class="quality-panel"><h2>${icon("document")} Qualidade e cobertura</h2>${qualityIssues.map(issue => `<div class="quality-summary-row"><span>${escapeHtml(issue.label)}</span><strong>${docs.filter(issue.test).length}</strong></div>`).join("")}<div class="quality-summary-row"><strong>Documentos na fila padrão</strong><strong>${problemDocs.length}</strong></div><p>As contagens se sobrepõem: um documento pode estar em mais de um grupo.</p></div>
          <div class="quality-panel"><h3>${icon("filter")} Filtros rápidos</h3><button class="quality-summary-row" style="width:100%;border:0;border-bottom:1px solid var(--line);background:${state.qualityIssue === "all" ? "var(--green-pale)" : "transparent"}" type="button" aria-pressed="${state.qualityIssue === "all"}" data-quality-issue="all"><span>Fila padrão</span><strong>${problemDocs.length}</strong></button>${qualityIssues.map(issue => `<button class="quality-summary-row" style="width:100%;border:0;border-bottom:1px solid var(--line);background:${state.qualityIssue === issue.id ? "var(--green-pale)" : "transparent"}" type="button" aria-pressed="${state.qualityIssue === issue.id}" data-quality-issue="${issue.id}"><span>${escapeHtml(issue.label)}</span><strong>${docs.filter(issue.test).length}</strong></button>`).join("")}</div>
        </aside>
      </div>
    </div>`;
  }

  function renderReviewRow(doc) {
    const priorityOrder = { Alta: 0, "Média": 1, Baixa: 2, Informativa: 3 };
    const issues = issuesFor(doc).sort((a, b) => {
      if (a.id === state.qualityIssue) return -1;
      if (b.id === state.qualityIssue) return 1;
      return priorityOrder[reviewPriority(a, doc)] - priorityOrder[reviewPriority(b, doc)];
    });
    const mostRelevant = issues[0];
    const priority = mostRelevant ? reviewPriority(mostRelevant, doc) : "Informativa";
    const issueChip = issue => `<span class="status-chip ${reviewPriority(issue, doc) === "Alta" ? "status-chip--danger" : reviewPriority(issue, doc) === "Média" ? "status-chip--warn" : "status-chip--muted"}">${escapeHtml(issue.label)}</span>`;
    return `<article class="review-row"><div class="document-cell">${coverMarkup(doc)}<div><h3>${escapeHtml(doc.titulo)}</h3><p>${escapeHtml((doc.autores || []).join("; ") || typeLabel(doc.tipo))}</p></div></div><span class="type-badge">${escapeHtml(typeLabel(doc.tipo))}</span><div class="review-row__issues"><div class="problem-list">${issues.slice(0, 2).map(issueChip).join("")}</div><details class="review-issues-extra"><summary>Ver ${issues.length === 1 ? "o ponto de atenção" : `todos os ${issues.length} pontos`}</summary><ul>${issues.map(issue => `<li>${issueChip(issue)}<p>${escapeHtml(issueObservation(issue, doc))}</p></li>`).join("")}</ul></details></div><div class="cell-main review-observation"><strong class="review-priority">${priority === "Informativa" ? "Cobertura informativa" : `Prioridade ${priority.toLocaleLowerCase("pt-BR")}`}</strong><p>${escapeHtml(mostRelevant ? issueObservation(mostRelevant, doc) : "Nenhuma pendência registrada.")}</p></div><button class="secondary-action" type="button" aria-label="Abrir ficha de ${escapeHtml(doc.titulo)}" data-open-detail="${escapeHtml(doc.id)}">Abrir ficha</button></article>`;
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
      <header class="detail-toolbar"><nav class="breadcrumbs" aria-label="Navegação estrutural"><button type="button" data-back-origin aria-label="Voltar à lista de origem">‹ Voltar</button><button type="button" data-view="catalog">${icon("home")} Catálogo</button><span>›</span><button type="button" data-filter-link="subject" data-value="${escapeHtml(doc.assunto || "")}">${escapeHtml(canonicalTopic(doc.assunto) || "Sem assunto")}</button><span>›</span><button type="button" data-filter-link="subsubject" data-value="${escapeHtml(doc.subassunto || "")}">${escapeHtml(canonicalTopic(doc.subassunto) || "Sem subassunto")}</button></nav><div class="detail-toolbar__navigation"><span class="detail-toolbar__title" title="${escapeHtml(doc.titulo)}">${escapeHtml(doc.titulo)}</span>${renderDocumentStepper(sequence, doc.id, "detail")}</div></header>
      <div class="detail-main">
        <section class="detail-hero">${coverMarkup(doc, "detail-cover")}<div class="detail-identity"><div class="detail-title"><span class="type-badge">${escapeHtml(typeLabel(doc.tipo))}</span><h1>${escapeHtml(doc.titulo)}</h1><p class="detail-authors">${escapeHtml((doc.autores || []).join("; ") || "Autoria não informada")}</p><div class="detail-subjects"><span>Assunto</span><strong>${escapeHtml(canonicalTopic(doc.assunto) || "Não informado")}</strong><span>Subassunto</span><strong>${escapeHtml(canonicalTopic(doc.subassunto) || "Não informado")}</strong></div><div class="tag-list">${displayTags(doc, 6).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div></div>${renderActionGroups(doc)}</div></section>
        ${renderCodeResources(doc)}
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
        <div id="detail-panel" class="detail-panel" role="tabpanel" aria-labelledby="detail-tab-${state.detailTab}" tabindex="0">${renderDetailRail(doc, citations, related, relations)}</div>
      </aside>
    </section>`;
  }

  function renderActionGroups(doc) {
    if (onlineMode) {
      return `<div class="action-groups action-groups--online"><section class="action-group"><h2>${icon("globe")} Ações públicas</h2><div class="action-group__buttons">${isOnline(doc) ? `<button class="primary-action" type="button" data-open-official="${escapeHtml(doc.id)}">${icon("external")} Ler online ${icon("chevron")}</button>` : `<p class="online-notice">Nenhum acesso público registrado.</p>`}<button type="button" data-copy-citation="${escapeHtml(doc.id)}" data-format="apa">${icon("quote")} Copiar citação APA</button><button type="button" data-open-network="${escapeHtml(doc.id)}">${icon("relations")} Explorar relações</button></div></section></div>`;
    }
    return `<div class="action-groups"><section class="action-group"><h2>${icon("monitor")} Ações locais</h2><div class="action-group__buttons"><button class="primary-action" type="button" data-open-pdf="${escapeHtml(doc.id)}">${icon("document")} Abrir PDF local ${icon("chevron")}</button>${doc.notaUri ? `<button type="button" data-open-note="${escapeHtml(doc.id)}">${icon("note")} Abrir nota local</button>` : ""}<button type="button" data-copy-path="${escapeHtml(doc.id)}">${icon("copy")} Copiar caminho</button></div></section><section class="action-group"><h2>${icon("globe")} Ações públicas</h2><div class="action-group__buttons">${isOnline(doc) ? `<button type="button" data-open-official="${escapeHtml(doc.id)}">${icon("external")} Ler online</button>` : `<p style="font:0.78rem var(--serif);color:var(--ink-soft)">Nenhum acesso público registrado.</p>`}<button type="button" data-copy-citation="${escapeHtml(doc.id)}" data-format="apa">${icon("quote")} Copiar citação APA</button><button type="button" data-open-network="${escapeHtml(doc.id)}">${icon("relations")} Explorar relações</button></div></section></div>`;
  }

  function renderCodeResources(doc) {
    const resources = codeResources(doc);
    if (!resources.length) return `<section class="detail-section code-resources code-resources--pending"><h2>${icon("code")} Código e implementações</h2><p class="code-resources__intro">Pesquisa não registrada: ainda não há fontes cadastradas para esta obra. Isso não significa que não existam implementações.</p></section>`;
    const origins = codeOriginOptions();
    return `<section class="detail-section code-resources"><h2>${icon("code")} Código e implementações <span class="type-badge">${resources.length} recurso(s)</span></h2><p class="code-resources__intro">Recursos cadastrados com a evidência da associação. Um índice ajuda a descobrir implementações, mas não é uma implementação verificada. Confirme a edição e as instruções do recurso antes de usar.</p><div class="code-resources__grid">${resources.map(item => `<a class="code-resource" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><span class="code-resource__type">${escapeHtml(item.tipo)}</span><strong>${escapeHtml(item.titulo)} ${icon("external")}</strong><span>${escapeHtml(item.descricao)}</span><small>Origem: ${escapeHtml(origins.find(origin => origin.value === codeOrigin(item)).label)} · classificação pelo tipo cadastrado</small><small>Evidência: ${escapeHtml(item.evidencia || "Não informada")}</small><span class="sr-only">Abre em uma nova aba</span></a>`).join("")}</div></section>`;
  }

  function biblioItem(label, value) {
    const displayed = ["Assunto", "Subassunto"].includes(label) ? canonicalTopic(value) : value;
    return `<div class="biblio-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(displayed || "Não informado")}</strong></div>`;
  }

  function biblioRow(...items) {
    return `<div class="biblio-row">${items.join("")}</div>`;
  }

  function renderCitationCard(doc, format) {
    const label = { bibtex: "BibTeX", apa: "APA", abnt: "ABNT" }[format];
    const value = window.Citacoes?.format ? window.Citacoes.format(doc, format) : format === "bibtex" ? doc.bibtex : "Formato indisponível";
    return `<article class="citation-card"><header><h3>${label}</h3><button type="button" aria-label="Copiar citação ${label}" data-copy-citation="${escapeHtml(doc.id)}" data-format="${format}">${icon("copy")} Copiar</button></header><div class="citation-content" id="citation-${format}">${format === "bibtex" ? `<pre>${escapeHtml(value)}</pre>` : `<p>${escapeHtml(value)}</p>`}</div><button type="button" class="citation-expand" data-expand-citation aria-expanded="false" aria-controls="citation-${format}">Expandir ${label}</button></article>`;
  }

  function detailTab(id, iconName, label, count = null) {
    const selected = state.detailTab === id;
    return `<button id="detail-tab-${id}" type="button" role="tab" data-detail-tab="${id}" aria-selected="${selected}" aria-controls="detail-panel" tabindex="${selected ? 0 : -1}">${icon(iconName)} <span>${label}${count !== null ? ` <b>${count}</b>` : ""}</span></button>`;
  }

  function renderDetailRail(doc, citations, related, relations) {
    if (state.detailTab === "references") return renderRelationPanel("Referências citadas", citations, onlineMode ? "Nenhuma obra do catálogo foi identificada na bibliografia deste documento." : "Nenhuma obra local foi identificada na bibliografia deste documento.");
    if (state.detailTab === "related") return renderRelationPanel("Documentos relacionados", related, "Não há documentos relacionados calculáveis.");
    if (state.detailTab === "relations") return `<section class="rail-panel"><header class="rail-panel__head"><h2>${icon("relations")} Relações bibliográficas</h2><button type="button" data-open-network="${escapeHtml(doc.id)}">Abrir rede</button></header>${renderRelationItems(relations, onlineMode ? "Nenhuma relação bibliográfica cadastrada." : "Nenhuma relação local confirmada.")}</section>`;
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
      const content = `<span>${escapeHtml(node.titulo)}</span>`;
      const label = escapeHtml(normalize(node.titulo));
      if (node.children.length) return `<li data-toc-label="${label}"><details ${depth === 1 && index < 4 ? "open" : ""}><summary>${content}</summary>${renderTocNodes(node.children, depth + 1)}</details></li>`;
      return `<li data-toc-label="${label}"><div class="toc-leaf">${content}</div></li>`;
    }).join("")}</ul>`;
  }

  function renderTocPanel(doc) {
    if (!doc.sumario?.length) return `<section class="rail-panel"><header class="rail-panel__head"><h2>${icon("toc")} Sumário</h2></header>${renderEmpty("Sumário indisponível", onlineMode ? "Nenhum sumário cadastrado para esta obra." : "Nenhum sumário em Markdown foi associado a esta obra.")}</section>`;
    return `<section class="rail-panel"><header class="rail-panel__head"><h2>${icon("toc")} Sumário</h2><span><button type="button" data-toc-action="expand">Expandir tudo</button> | <button type="button" data-toc-action="collapse">Recolher tudo</button></span></header><label class="toc-search">${icon("search")}<span class="sr-only">Buscar título no sumário</span><input type="search" data-toc-search aria-controls="detail-toc-tree" placeholder="Buscar título no sumário…" autocomplete="off"></label><p class="toc-search__status" data-toc-status role="status" aria-live="polite" hidden></p><div id="detail-toc-tree" class="toc-tree">${renderTocNodes(buildToc(doc.sumario))}</div></section>`;
  }

  /* Rede bibliográfica */

  function visibleNetworkLinks(id) {
    const query = expandSearchQuery(state.networkQuery);
    return relationLinks(id).map(link => {
      const outgoing = link.outgoing && state.networkFilters.outgoing;
      const incoming = link.incoming && state.networkFilters.incoming;
      const shared = state.networkFilters.shared ? link.shared : 0;
      const similarity = state.networkFilters.affinity ? link.similarity : 0;
      if (!outgoing && !incoming && !shared && !similarity) return null;
      const doc = docsById.get(link.id);
      if (query && !expandSearchQuery([doc.titulo, ...(doc.autores || []), doc.assunto, doc.subassunto].join(" ")).includes(query)) return null;
      return { ...link, outgoing, incoming, shared, similarity,
        evidence: outgoing || incoming ? link.evidence : "",
        page: outgoing || incoming ? link.page : null,
      };
    }).filter(Boolean);
  }

  function renderNetwork() {
    const center = docsById.get(state.networkId) || preferred;
    if (!center) return renderEmpty("Rede indisponível", "Nenhum documento central foi selecionado.");
    const sequence = networkSequence(center.id);
    const links = visibleNetworkLinks(center.id);
    const target = links.find(link => link.id === state.networkTargetId) || links[0] || null;
    state.networkTargetId = target?.id || "";
    const targetIndex = target ? links.findIndex(link => link.id === target.id) : -1;
    const windowStart = targetIndex < 0 ? 0 : Math.floor(targetIndex / 6) * 6;
    const visible = links.slice(windowStart, windowStart + 6);
    return `${renderModeStrip(`<button type="button" aria-pressed="true">${icon("relations")} Relações bibliográficas</button>`)}
      <section class="network-page" data-sidebar-open="${state.networkSidebarOpen}">
        <button class="network-sidebar-toggle" type="button" data-network-sidebar aria-expanded="${state.networkSidebarOpen}" aria-controls="network-sidebar">${icon("filter")} Explorar relações <span>${links.length}</span></button>
        <aside class="network-sidebar" id="network-sidebar"><h2>Explorar relações</h2><div class="relation-types"><strong>Tipo de relação</strong>${networkFilter("outgoing", "Cita", "line-key")}${networkFilter("incoming", "É citado por", "line-key--incoming")}${networkFilter("shared", "Referências compartilhadas", "line-key--shared")}${networkFilter("affinity", "Afinidade temática", "line-key--affinity")}</div><label class="global-search" style="margin-bottom:.8rem">${icon("search")}<input type="search" data-network-search value="${escapeHtml(state.networkQuery)}" aria-label="Buscar obras relacionadas" placeholder="Buscar na rede…"></label><p><strong>Obras relacionadas (${links.length})</strong></p><div class="network-list">${links.length ? links.map(link => renderNetworkListButton(link, target?.id)).join("") : renderEmpty("Nenhuma obra encontrada", "Revise a busca ou ative outros tipos de relação.")}</div></aside>
        <section class="network-canvas"><header class="network-canvas__head"><div><h1>Rede bibliográfica</h1><p>Obras relacionadas a “${escapeHtml(center.titulo)}”</p></div>${renderDocumentStepper(sequence, center.id, "network")}</header><nav class="network-relations-nav" aria-label="Navegar entre obras relacionadas"><span>${target ? `${targetIndex + 1} de ${links.length} relações · ${windowStart + 1}–${Math.min(windowStart + 6, links.length)} no gráfico` : "Nenhuma relação visível"}</span><div><button type="button" data-network-link-step="-1" aria-label="Relação anterior" ${links.length < 2 ? "disabled" : ""}>‹</button><button type="button" data-network-link-step="1" aria-label="Próxima relação" ${links.length < 2 ? "disabled" : ""}>›</button></div></nav><p class="network-canvas__hint">Deslize horizontalmente para explorar o gráfico.</p>${renderGraph(center, visible, target?.id)}</section>
        ${renderNetworkDetail(center, target)}
      </section>`;
  }

  function networkFilter(id, label, keyClass) {
    return `<label><input type="checkbox" data-network-filter="${id}" ${state.networkFilters[id] ? "checked" : ""}><span>${label}</span><i class="line-key ${keyClass}"></i></label>`;
  }

  function renderNetworkListButton(link, selectedId) {
    const doc = docsById.get(link.id);
    const identity = docIdentity(doc);
    return `<button class="network-list-button" type="button" data-network-target="${escapeHtml(link.id)}" aria-pressed="${link.id === selectedId}">${coverMarkup(doc)}<span><strong>${escapeHtml(doc.titulo)}</strong>${identity ? `<small class="doc-identity">${escapeHtml(identity)}</small>` : ""}<span>${escapeHtml(canonicalTopic(doc.assunto) || typeLabel(doc.tipo))}</span></span>${icon("chevron")}</button>`;
  }

  const graphPositions = {
    1: [{ x: 500, y: 110 }],
    2: [{ x: 165, y: 400 }, { x: 835, y: 400 }],
    3: [{ x: 500, y: 110 }, { x: 835, y: 570 }, { x: 165, y: 570 }],
    4: [{ x: 165, y: 230 }, { x: 835, y: 230 }, { x: 835, y: 570 }, { x: 165, y: 570 }],
    5: [{ x: 500, y: 110 }, { x: 835, y: 230 }, { x: 835, y: 570 }, { x: 165, y: 570 }, { x: 165, y: 230 }],
    6: [{ x: 500, y: 110 }, { x: 835, y: 230 }, { x: 835, y: 570 }, { x: 500, y: 690 }, { x: 165, y: 570 }, { x: 165, y: 230 }],
  };

  function renderGraph(center, links, selectedId) {
    const centerIdentity = docIdentity(center);
    const positions = graphPositions[links.length] || [];
    const lines = links.map((link, index) => {
      const position = positions[index];
      const kind = relationKind(link);
      const dx = position.x - 500;
      const dy = position.y - 400;
      const distance = Math.hypot(dx, dy);
      const centerEdge = { x: 500 + dx * 128 / distance, y: 400 + dy * 128 / distance };
      const outerEdge = { x: position.x - dx * 100 / distance, y: position.y - dy * 100 / distance };
      const from = link.incoming && !link.outgoing ? outerEdge : centerEdge;
      const to = link.incoming && !link.outgoing ? centerEdge : outerEdge;
      const labelX = (position.x + 500) / 2;
      const labelY = (position.y + 400) / 2 - 8;
      const mutual = link.outgoing && link.incoming;
      const label = mutual ? "citação mútua" : kind === "outgoing" ? "cita" : kind === "incoming" ? "é citado por" : kind === "shared" ? `${link.shared} refs.` : `${Math.round(link.similarity * 100)}%`;
      const marker = !mutual && (kind === "outgoing" || kind === "incoming") ? ` marker-end="url(#arrow-${kind})"` : "";
      return `<line class="graph-line graph-line--${kind}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"${marker}/><text class="graph-line-label" x="${labelX}" y="${labelY}" text-anchor="middle">${escapeHtml(label)}</text>`;
    }).join("");
    const nodes = links.map((link, index) => {
      const doc = docsById.get(link.id);
      const position = positions[index];
      const identity = docIdentity(doc);
      return `<button class="graph-node" type="button" data-network-target="${escapeHtml(doc.id)}" aria-label="Selecionar relação com ${escapeHtml(doc.titulo)}${identity ? `, ${escapeHtml(identity)}` : ""}" title="${escapeHtml(doc.titulo)}${identity ? ` · ${escapeHtml(identity)}` : ""}" aria-pressed="${doc.id === selectedId}" style="left:${position.x / 10}%;top:${position.y / 8}%">${coverMarkup(doc)}<strong>${escapeHtml(truncate(doc.titulo, 46))}</strong>${identity ? `<small class="doc-identity">${escapeHtml(identity)}</small>` : ""}</button>`;
    }).join("");
    return `<div class="graph"><svg viewBox="0 0 1000 800" aria-hidden="true"><defs><marker id="arrow-outgoing" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#0b4a32"/></marker><marker id="arrow-incoming" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#a47a20"/></marker><marker id="arrow-shared" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#265f86"/></marker><marker id="arrow-affinity" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#86a69b"/></marker></defs>${lines}</svg>${nodes}<button class="graph-node graph-node--center" type="button" data-open-detail="${escapeHtml(center.id)}" aria-label="Abrir ficha de ${escapeHtml(center.titulo)}${centerIdentity ? `, ${escapeHtml(centerIdentity)}` : ""}" style="left:50%;top:50%">${coverMarkup(center)}<strong>${escapeHtml(center.titulo)}</strong>${centerIdentity ? `<small class="doc-identity">${escapeHtml(centerIdentity)}</small>` : ""}</button></div>`;
  }

  function renderNetworkDetail(center, link) {
    if (!link) return `<aside class="network-detail"><h2>Detalhes da relação</h2>${renderEmpty("Nenhuma relação visível", "Ative um tipo de relação ou escolha outro documento central.")}</aside>`;
    const target = docsById.get(link.id);
    const pair = doc => `${coverMarkup(doc)}<strong>${escapeHtml(doc.titulo)}</strong>${docIdentity(doc) ? `<small class="doc-identity">${escapeHtml(docIdentity(doc))}</small>` : ""}`;
    const evidence = onlineMode ? "" : `<div><dt>Evidência</dt><dd>${escapeHtml(truncate(link.evidence || "Relação calculada a partir dos metadados e referências locais.", 420))}</dd></div>${link.page ? `<div><dt>Página</dt><dd>${link.page}</dd></div>` : ""}`;
    const mutual = link.outgoing && link.incoming;
    const arrow = mutual || (!link.outgoing && !link.incoming) ? "↔" : link.outgoing ? "→" : "←";
    const kind = (link.outgoing || link.incoming) && !mutual ? "Citação direta" : relationLabel(link);
    const direction = mutual ? `${center.titulo} ↔ ${target.titulo}` : link.outgoing ? `${center.titulo} → ${target.titulo}` : link.incoming ? `${target.titulo} → ${center.titulo}` : "Relação simétrica";
    return `<aside class="network-detail"><h2>Detalhes da relação</h2><div class="network-detail__pair"><div>${pair(center)}</div><span class="network-arrow">${arrow}</span><div>${pair(target)}</div></div><dl class="relation-facts"><div><dt>Tipo de relação</dt><dd>${escapeHtml(kind)}</dd></div><div><dt>Direção</dt><dd>${escapeHtml(direction)}</dd></div>${evidence}${link.shared ? `<div><dt>Referências compartilhadas</dt><dd>${link.shared}</dd></div>` : ""}${link.similarity ? `<div><dt>Afinidade</dt><dd>${Math.round(link.similarity * 100)}%</dd></div>` : ""}</dl><button class="primary-action" style="width:100%;margin-top:1rem" type="button" data-open-detail="${escapeHtml(target.id)}">Abrir ficha de ${escapeHtml(truncate(target.titulo, 42))} ${icon("arrow")}</button></aside>`;
  }

  function rerenderNetwork(focusSelector = "", selection = null, revealSelected = false) {
    const sidebarTop = app.querySelector(".network-sidebar")?.scrollTop || 0;
    const canvas = app.querySelector(".network-canvas");
    const canvasTop = canvas?.scrollTop || 0;
    const canvasLeft = canvas?.scrollLeft || 0;
    render();
    const sidebar = app.querySelector(".network-sidebar");
    const nextCanvas = app.querySelector(".network-canvas");
    if (sidebar) sidebar.scrollTop = sidebarTop;
    if (nextCanvas) {
      nextCanvas.scrollTop = canvasTop;
      nextCanvas.scrollLeft = canvasLeft;
      if (revealSelected) {
        const selectedNode = nextCanvas.querySelector(".graph-node[aria-pressed='true']");
        if (selectedNode) {
          const nodeRect = selectedNode.getBoundingClientRect();
          const canvasRect = nextCanvas.getBoundingClientRect();
          nextCanvas.scrollLeft += nodeRect.left + nodeRect.width / 2 - canvasRect.left - canvasRect.width / 2;
        }
      }
    }
    const control = focusSelector ? app.querySelector(focusSelector) : null;
    control?.focus({ preventScroll: true });
    if (selection && control?.setSelectionRange) control.setSelectionRange(selection.start, selection.end);
  }

  /* Interações */

  function setView(view) {
    if (onlineMode && ["text", "quality"].includes(view)) view = "catalog";
    if (view === "detail" && state.view !== "detail" && !state.detailOrigin) captureDetailOrigin();
    if (view !== "detail") state.detailOrigin = null;
    state.view = view;
    state.menuOpen = false;
    state.previewOpen = false;
    if (view === "catalog") state.searchMode = "metadata";
    if (view === "collections") state.collectionOnly = "";
    if (view === "network") state.networkId = state.selectedId || preferred?.id || "";
    render({ preserve: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
    app.querySelector("#main")?.focus({ preventScroll: true });
  }

  function openDocumentUri(doc, page = null) {
    if (onlineMode) return;
    if (!doc?.pdfUri) return showToast("O PDF local não está disponível.");
    const suffix = page ? `#page=${Number(page) || 1}` : "";
    window.open(`${doc.pdfUri}${suffix}`, "_blank", "noopener");
  }

  function showToast(message) {
    state.toast = message;
    window.clearTimeout(toastTimer);
    app.querySelector(".toast")?.remove();
    const notice = document.createElement("div");
    notice.className = "toast";
    notice.setAttribute("role", "status");
    notice.textContent = message;
    app.append(notice);
    toastTimer = window.setTimeout(() => {
      if (state.toast === message) {
        state.toast = "";
        app.querySelector(".toast")?.remove();
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

    if (event.target.closest("[data-more-filters]")) {
      state.filtersOpen = !state.filtersOpen;
      return render();
    }
    if (event.target.closest("[data-toggle-preview]")) {
      state.previewCollapsed = !state.previewCollapsed;
      state.previewOpen = !state.previewCollapsed;
      return render();
    }
    const removedFilter = event.target.closest("[data-remove-filter]");
    if (removedFilter) {
      const key = removedFilter.dataset.removeFilter;
      if (key === "query") {
        state.query = "";
        clearTextSearch();
      } else if (key === "collection") state.collectionOnly = "";
      else if (Object.hasOwn(state.filters, key)) state.filters[key] = "";
      state.limit = 60;
      state.textLimit = 30;
      render();
      app.querySelector("[data-more-filters]")?.focus({ preventScroll: true });
      return;
    }

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
      state.query = app.querySelector("#global-query")?.value.trim() || "";
      state.searchMode = mode.dataset.searchMode;
      if (state.searchMode === "content") {
        state.view = "text";
        if (state.query) return runTextSearch();
        clearTextSearch();
      } else {
        clearTextSearch();
        state.view = "catalog";
      }
      render({ preserve: false });
      app.querySelector(`[data-search-mode="${state.searchMode}"]`)?.focus({ preventScroll: true });
      return;
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
      state.previewCollapsed = false;
      render();
      window.requestAnimationFrame(() => {
        const focusTarget = window.matchMedia?.("(max-width: 900px)").matches
          ? app.querySelector("[data-close-preview]")
          : app.querySelector('.catalog-row__select[aria-pressed="true"]');
        focusTarget?.focus({ preventScroll: true });
      });
      return;
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
      const direction = detailStep.dataset.detailStep;
      const sequence = detailSequence(state.selectedId);
      const current = Math.max(0, sequence.findIndex(doc => doc.id === state.selectedId));
      const next = (current + Number(direction) + sequence.length) % Math.max(1, sequence.length);
      if (sequence[next]) state.selectedId = sequence[next].id;
      render({ preserve: false });
      scrollPanelsToStart([".detail-main", ".detail-rail"]);
      window.scrollTo({ top: 0 });
      window.requestAnimationFrame(() => app.querySelector(`[data-detail-step="${direction}"]`)?.focus());
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
        state.networkQuery = "";
      }
      render();
      scrollPanelsToStart([".network-sidebar", ".network-canvas", ".network-detail"]);
      return;
    }

    const networkSidebar = event.target.closest("[data-network-sidebar]");
    if (networkSidebar) {
      state.networkSidebarOpen = !state.networkSidebarOpen;
      return rerenderNetwork("[data-network-sidebar]");
    }

    const networkLinkStep = event.target.closest("[data-network-link-step]");
    if (networkLinkStep) {
      const links = visibleNetworkLinks(state.networkId);
      if (links.length < 2) return;
      const current = Math.max(0, links.findIndex(link => link.id === state.networkTargetId));
      const next = (current + Number(networkLinkStep.dataset.networkLinkStep) + links.length) % links.length;
      state.networkTargetId = links[next].id;
      return rerenderNetwork(`[data-network-link-step="${networkLinkStep.dataset.networkLinkStep}"]`, null, true);
    }

    const detail = event.target.closest("[data-open-detail]");
    if (detail) {
      captureDetailOrigin(detail);
      state.selectedId = detail.dataset.openDetail;
      state.detailTab = "toc";
      return setView("detail");
    }

    if (event.target.closest("[data-back-origin]")) return returnToDetailOrigin();

    const pdf = event.target.closest("[data-open-pdf]");
    if (pdf) return openDocumentUri(docsById.get(pdf.dataset.openPdf), pdf.dataset.page);

    const note = event.target.closest("[data-open-note]");
    if (note) {
      if (onlineMode) return;
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
    if (copyPath) return onlineMode ? undefined : copyText(docsById.get(copyPath.dataset.copyPath)?.pdf, "Caminho copiado.");

    const copyCitation = event.target.closest("[data-copy-citation]");
    if (copyCitation) {
      const doc = docsById.get(copyCitation.dataset.copyCitation);
      const format = copyCitation.dataset.format || "bibtex";
      const value = window.Citacoes?.format ? window.Citacoes.format(doc, format) : doc?.bibtex;
      return copyText(value, `Citação ${format.toLocaleUpperCase("pt-BR")} copiada.`);
    }

    const expandedCitation = event.target.closest("[data-expand-citation]");
    if (expandedCitation) {
      const expanded = expandedCitation.getAttribute("aria-expanded") !== "true";
      expandedCitation.setAttribute("aria-expanded", String(expanded));
      expandedCitation.closest(".citation-card").dataset.expanded = String(expanded);
      expandedCitation.textContent = `${expanded ? "Recolher" : "Expandir"} ${expandedCitation.closest(".citation-card").querySelector("h3").textContent}`;
      return;
    }

    const clear = event.target.closest("[data-clear-filters]");
    if (clear) {
      state.query = "";
      clearTextSearch();
      state.collectionOnly = "";
      Object.keys(state.filters).forEach(key => { state.filters[key] = ""; });
      state.limit = 60;
      render({ preserve: false });
      app.querySelector("#global-query")?.focus({ preventScroll: true });
      return;
    }

    if (event.target.closest("[data-load-more]")) {
      state.limit += 60;
      return render();
    }

    if (event.target.closest("[data-load-more-text]")) {
      state.textLimit += 30;
      return render();
    }

    const openCollection = event.target.closest("[data-open-collection]");
    if (openCollection) {
      state.view = "catalog";
      state.searchMode = "metadata";
      state.limit = 60;
      state.collectionOnly = openCollection.dataset.openCollection;
      state.selectedId = filteredDocs()[0]?.id || state.selectedId;
      render({ preserve: false });
      window.scrollTo({ top: 0 });
      app.querySelector("#main")?.focus({ preventScroll: true });
      return;
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
      document.querySelectorAll(".toc-tree details").forEach(item => {
        item.open = tocAction.dataset.tocAction === "expand";
        if (item.dataset.tocWasOpen !== undefined) item.dataset.tocWasOpen = String(item.open);
      });
      return;
    }

    const openNetwork = event.target.closest("[data-open-network]");
    if (openNetwork) {
      state.networkId = openNetwork.dataset.openNetwork;
      state.selectedId = state.networkId;
      state.networkTargetId = "";
      state.networkQuery = "";
      return setView("network");
    }

    const target = event.target.closest("[data-network-target]");
    if (target) {
      state.networkTargetId = target.dataset.networkTarget;
      const selector = target.classList.contains("graph-node") ? ".graph-node[aria-pressed='true']" : ".network-list-button[aria-pressed='true']";
      return rerenderNetwork(selector, null, true);
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
      state.textLimit = 30;
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
      return rerenderNetwork(`[data-network-filter="${networkFilter.dataset.networkFilter}"]`);
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
    clearTextSearch();
    state.view = "catalog";
    render({ preserve: false });
  });

  app.addEventListener("input", event => {
    const tocSearch = event.target.closest("[data-toc-search]");
    if (tocSearch) {
      const panel = tocSearch.closest(".rail-panel");
      const tree = panel?.querySelector(".toc-tree");
      if (!tree) return;
      const value = normalize(tocSearch.value);
      if (value && tree.dataset.searchActive !== "true") {
        tree.dataset.searchActive = "true";
        tree.querySelectorAll("details").forEach(item => { item.dataset.tocWasOpen = String(item.open); });
      }
      let count = 0;
      [...tree.querySelectorAll("li[data-toc-label]")].reverse().forEach(item => {
        const match = !value || item.dataset.tocLabel.includes(value);
        if (value && match) count++;
        const children = item.querySelector(":scope > details > ul")?.children || [];
        const hasMatchBelow = [...children].some(child => !child.hidden);
        item.hidden = Boolean(value && !match && !hasMatchBelow);
        if (value && hasMatchBelow) item.querySelector(":scope > details").open = true;
      });
      if (!value && tree.dataset.searchActive === "true") {
        tree.querySelectorAll("details").forEach(item => {
          item.open = item.dataset.tocWasOpen === "true";
          delete item.dataset.tocWasOpen;
        });
        delete tree.dataset.searchActive;
      }
      const status = panel.querySelector("[data-toc-status]");
      status.hidden = !value;
      status.textContent = count ? `${count} ${count === 1 ? "título encontrado" : "títulos encontrados"}.` : "Nenhum título encontrado.";
      return;
    }
    const networkSearch = event.target.closest("[data-network-search]");
    if (!networkSearch) return;
    state.networkQuery = networkSearch.value;
    const selection = { start: networkSearch.selectionStart, end: networkSearch.selectionEnd };
    rerenderNetwork("[data-network-search]", selection);
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
    const current = Math.max(0, tabs.indexOf(tab.dataset.detailTab));
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

  window.addEventListener?.("resize", updateSiteHeaderHeight);
  window.MeuAcervoV2 = { state, render, setView, runTextSearch };
  render();
})();
