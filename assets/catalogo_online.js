(() => {
  "use strict";

  const catalogo = Array.isArray(window.CATALOGO) ? window.CATALOGO : [];
  const meta = window.CATALOGO_META || {};
  const citacoes = window.Citacoes;
  const rede = window.RedeCitacoes;
  const afinidade = window.MapaAfinidade;
  const dendrograma = window.DendrogramaAfinidade;
  const qualidade = window.QualidadeBiblioteca;
  const pageSize = 48;
  let limite = pageSize;
  let resultados = [];
  let colecaoAtiva = null;
  let layoutMode = readPreference("ebib-layout", "grid");
  let compactCards = readPreference("ebib-density", "comfortable") === "compact";
  let previewedId = "";
  let selectionMode = false;
  let activeView = "biblioteca";
  const selecionados = new Set();
  let toastTimer;

  const el = {
    busca: document.querySelector("#busca"),
    assunto: document.querySelector("#filtro-assunto"),
    subassunto: document.querySelector("#filtro-subassunto"),
    tipo: document.querySelector("#filtro-tipo"),
    publicacao: document.querySelector("#filtro-publicacao"),
    ano: document.querySelector("#filtro-ano"),
    qualidade: document.querySelector("#filtro-qualidade"),
    ordenacao: document.querySelector("#ordenacao"),
    alternarFiltros: document.querySelector("#alternar-filtros"),
    queryPanel: document.querySelector(".query-panel"),
    limpar: document.querySelector("#limpar"),
    limparNav: document.querySelector("#limpar-filtros-nav"),
    toggleDensity: document.querySelector("#toggle-density"),
    grade: document.querySelector("#grade"),
    resultsWorkspace: document.querySelector("#results-workspace"),
    preview: document.querySelector("#ficha-rapida"),
    vazio: document.querySelector("#estado-vazio"),
    contagem: document.querySelector("#resultado-contagem"),
    ativos: document.querySelector("#filtros-ativos"),
    mais: document.querySelector("#carregar-mais"),
    dialog: document.querySelector("#detalhes"),
    fechar: document.querySelector("#fechar-detalhes"),
    conteudo: document.querySelector("#detalhes-conteudo"),
    toast: document.querySelector("#toast"),
    exportacao: document.querySelector("#barra-exportacao"),
    selecaoContagem: document.querySelector("#selecao-contagem"),
    selecionarExibidos: document.querySelector("#selecionar-exibidos"),
    formatoExportacao: document.querySelector("#formato-exportacao"),
    copiarSelecao: document.querySelector("#copiar-selecao"),
    baixarSelecao: document.querySelector("#baixar-selecao"),
    limparSelecao: document.querySelector("#limpar-selecao"),
    compararSelecao: document.querySelector("#comparar-selecao"),
    toggleSelectionMode: document.querySelector("#toggle-selection-mode"),
    dendrogramaSelecao: document.querySelector("#dendrograma-selecao"),
    abrirDendrograma: document.querySelector("#abrir-dendrograma"),
    dendrogramaDialog: document.querySelector("#dendrograma-afinidade"),
    dendrogramaConteudo: document.querySelector("#dendrograma-conteudo"),
    fecharDendrograma: document.querySelector("#fechar-dendrograma"),
    redeDialog: document.querySelector("#rede-bibliografica"),
    redeConteudo: document.querySelector("#rede-conteudo"),
    fecharRede: document.querySelector("#fechar-rede"),
    bibliotecaView: document.querySelector("#biblioteca-view"),
    colecoesView: document.querySelector("#colecoes-view"),
    colecoesPage: document.querySelector("#colecoes-page"),
    relacoesView: document.querySelector("#relacoes-view"),
    relacoesDocumento: document.querySelector("#relacoes-documento"),
    relacoesResumo: document.querySelector("#relacoes-resumo"),
    qualidadeView: document.querySelector("#qualidade-view"),
    qualidadePage: document.querySelector("#qualidade-page"),
    comparacaoDialog: document.querySelector("#comparacao-documentos"),
    comparacaoConteudo: document.querySelector("#comparacao-conteudo"),
    fecharComparacao: document.querySelector("#fechar-comparacao"),
  };

  function readPreference(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function writePreference(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // A interface continua funcional quando o navegador bloqueia armazenamento local.
    }
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base" })
    );
  }

  function parseQuery(value) {
    const filters = [];
    const pattern = /(assunto|subassunto|autor|tipo|titulo|tag|publicacao|publicação|ano|qualidade):(?:"([^"]+)"|(\S+))/gi;
    const free = value.replace(pattern, (_, field, quoted, plain) => {
      filters.push({ field: normalize(field), value: normalize(quoted || plain) });
      return " ";
    });
    return {
      filters,
      free: normalize(free).split(/\s+/).filter(Boolean),
    };
  }

  function searchable(record) {
    return normalize([
      record.titulo,
      ...(record.autores || []),
      record.assunto,
      record.subassunto,
      record.tipo,
      record.publicacao,
      record.ano,
      record.bibStatus,
      ...(record.tags || []),
      record.nomeArquivo,
    ].join(" "));
  }

  function fieldText(record, field) {
    const fields = {
      assunto: record.assunto,
      subassunto: record.subassunto,
      autor: (record.autores || []).join(" "),
      tipo: record.tipo,
      publicacao: record.publicacao,
      titulo: record.titulo,
      tag: (record.tags || []).join(" "),
      ano: record.ano,
      qualidade: qualidade?.issues(record).join(" ") || "",
    };
    return normalize(fields[field]);
  }

  function stateFromControls() {
    return {
      q: el.busca.value.trim(),
      assunto: el.assunto.value,
      subassunto: el.subassunto.value,
      tipo: el.tipo.value,
      publicacao: el.publicacao.value,
      ano: el.ano.value,
      qualidade: el.qualidade.value,
      ordem: el.ordenacao.value,
    };
  }

  function stateFromUrl() {
    const params = new URLSearchParams(location.search);
    return {
      q: params.get("q") || "",
      assunto: params.get("assunto") || "",
      subassunto: params.get("subassunto") || "",
      tipo: params.get("tipo") || "",
      publicacao: params.get("publicacao") || "",
      ano: params.get("ano") || "",
      qualidade: params.get("qualidade") || "",
      ordem: params.get("ordem") || "titulo",
    };
  }

  function writeUrl(state) {
    const params = new URLSearchParams();
    Object.entries(state).forEach(([key, value]) => {
      if (value && !(key === "ordem" && value === "titulo")) params.set(key, value);
    });
    const next = `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`;
    try {
      history.replaceState(null, "", next);
    } catch {
      // Alguns navegadores restringem o histórico em páginas abertas via file://.
    }
  }

  function countsBy(records, field) {
    return records.reduce((counts, record) => {
      const value = record[field];
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
      return counts;
    }, new Map());
  }

  function fillSelect(select, values, label, counts = null) {
    const current = select.value;
    select.innerHTML = `<option value="">${label}</option>` + values
      .map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}${counts ? ` (${counts.get(value) || 0})` : ""}</option>`)
      .join("");
    if (values.includes(current)) select.value = current;
  }

  function updateSubsubjects() {
    const subject = el.assunto.value;
    const source = subject
      ? catalogo.filter(item => item.assunto === subject)
      : catalogo;
    fillSelect(
      el.subassunto,
      uniqueSorted(source.map(item => item.subassunto)),
      "Todos os subassuntos",
      countsBy(source, "subassunto")
    );
  }

  function sortRecords(items, order) {
    const sorted = [...items];
    const compare = (a, b) => String(a || "").localeCompare(
      String(b || ""), "pt-BR", { sensitivity: "base" }
    );
    sorted.sort((a, b) => {
      if (order === "autor") return compare(a.autores?.[0], b.autores?.[0]) || compare(a.titulo, b.titulo);
      if (order === "assunto") return compare(a.assunto, b.assunto) || compare(a.subassunto, b.subassunto) || compare(a.titulo, b.titulo);
      if (order === "ano-desc") return compare(b.ano, a.ano) || compare(a.titulo, b.titulo);
      if (order === "ano-asc") return compare(a.ano || "9999", b.ano || "9999") || compare(a.titulo, b.titulo);
      return compare(a.titulo, b.titulo);
    });
    return sorted;
  }

  function filterRecords(state) {
    const query = parseQuery(state.q);
    return sortRecords(catalogo.filter(record => {
      if (colecaoAtiva && !colecaoAtiva.ids.has(record.id)) return false;
      if (state.assunto && record.assunto !== state.assunto) return false;
      if (state.subassunto && record.subassunto !== state.subassunto) return false;
      if (state.tipo && record.tipo !== state.tipo) return false;
      if (state.publicacao && record.publicacao !== state.publicacao) return false;
      if (state.ano && record.ano !== state.ano) return false;
      if (state.qualidade && !qualidade?.matches(record, state.qualidade)) return false;
      if (!query.free.every(term => searchable(record).includes(term))) return false;
      return query.filters.every(({ field, value }) => fieldText(record, field).includes(value));
    }), state.ordem);
  }

  function coverMarkup(record, className = "") {
    if (record.capa) {
      return `<img class="${className}" src="${escapeHtml(record.capa)}" alt="Primeira página de ${escapeHtml(record.titulo)}" loading="lazy">`;
    }
    return `<div class="cover-placeholder ${className}"><span>${escapeHtml(record.titulo)}</span></div>`;
  }

  function cardMarkup(record) {
    const authors = record.autores?.length ? record.autores.join("; ") : "Autoria não identificada";
    const availability = onlineAvailability(record);
    const bibLabels = { verificado: "Bib verificado", estrutural: "Bib não verificado", pendente: "Bib pendente" };
    return `
      <article class="book-card ${selecionados.has(record.id) ? "book-card--selected" : ""} ${previewedId === record.id ? "book-card--previewed" : ""}">
        <label class="book-card__select">
          <input type="checkbox" data-select="${record.id}" ${selecionados.has(record.id) ? "checked" : ""}>
          <span>Selecionar</span>
        </label>
        <div class="book-card__button">
          <div class="cover-frame">
            ${coverMarkup(record)}
            ${availability ? `<span class="book-card__online book-card__online--${availability.kind}">${escapeHtml(availability.label)}</span>` : ""}
          </div>
          <div class="book-card__body">
            <p class="book-card__subject">${escapeHtml(record.assunto)} · ${escapeHtml(record.subassunto)}</p>
            <h3>${escapeHtml(record.titulo)}</h3>
            <p class="book-card__authors">${escapeHtml(authors)}</p>
            <p class="book-card__publication-line">${escapeHtml(record.publicacao || "Publicação não identificada")}</p>
            <div class="book-card__footer">
              <span>${escapeHtml(record.tipo)}${record.ano ? ` · ${escapeHtml(record.ano)}` : ""}${record.paginas ? ` · ${record.paginas} p.` : ""}</span>
              <span class="bib-state bib-state--${escapeHtml(record.bibStatus || "pendente")}">${escapeHtml(bibLabels[record.bibStatus] || "Bib pendente")}</span>
            </div>
          </div>
        </div>
        <button class="book-card__open" type="button" data-preview="${record.id}" aria-label="Visualizar resumo de ${escapeHtml(record.titulo)}"></button>
      </article>`;
  }

  function tableMarkup(records) {
    return `
      <div class="catalog-table-wrap">
        <table class="catalog-table">
          <thead><tr><th class="catalog-table__select">Selecionar</th><th>Título</th><th>Autoria</th><th>Ano</th><th>Publicação</th><th>Tipo</th><th>Assunto</th></tr></thead>
          <tbody>${records.map(record => `
            <tr class="${selecionados.has(record.id) ? "catalog-table__row--selected" : ""}">
              <td class="catalog-table__select"><input type="checkbox" data-select="${escapeHtml(record.id)}" aria-label="Selecionar ${escapeHtml(record.titulo)}" ${selecionados.has(record.id) ? "checked" : ""}></td>
              <td><button type="button" data-open="${escapeHtml(record.id)}">${escapeHtml(record.titulo)}</button></td>
              <td>${escapeHtml((record.autores || []).join("; ") || "Não identificada")}</td>
              <td>${escapeHtml(record.ano || "—")}</td>
              <td>${escapeHtml(record.publicacao || "—")}</td>
              <td>${escapeHtml(record.tipo || "—")}</td>
              <td>${escapeHtml(record.assunto || "—")}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>`;
  }

  function activeFiltersMarkup(state) {
    const filters = [
      ["q", state.q, "Busca"],
      ["assunto", state.assunto, "Assunto"],
      ["subassunto", state.subassunto, "Subassunto"],
      ["tipo", state.tipo, "Tipo"],
      ["publicacao", state.publicacao, "Publicação"],
      ["ano", state.ano, "Ano"],
      ["qualidade", state.qualidade ? qualidade?.label(state.qualidade) : "", "Qualidade"],
      ["colecao", colecaoAtiva?.label || "", "Coleção sugerida"],
    ].filter(([, value]) => value);
    el.ativos.innerHTML = filters.map(([field, value, label]) =>
      `<button type="button" class="filter-chip" data-remove="${field}">${escapeHtml(label)}: ${escapeHtml(value)} <span aria-hidden="true">×</span></button>`
    ).join("");
    if (el.limparNav) {
      el.limparNav.hidden = filters.length === 0;
      el.limparNav.textContent = `Limpar filtros (${filters.length})`;
    }
    if (el.alternarFiltros) {
      const label = el.alternarFiltros.getAttribute("aria-expanded") === "true" ? "Ocultar filtros" : "Filtros";
      el.alternarFiltros.textContent = filters.length ? `${label} (${filters.length})` : label;
    }
  }

  function render(reset = false) {
    if (reset) limite = pageSize;
    const state = stateFromControls();
    resultados = filterRecords(state);
    if (previewedId && !resultados.some(record => record.id === previewedId)) closePreview();
    const visible = resultados.slice(0, limite);
    el.grade.className = `catalog-grid catalog-grid--${layoutMode}`;
    el.grade.innerHTML = layoutMode === "table" ? tableMarkup(visible) : visible.map(cardMarkup).join("");
    el.vazio.hidden = resultados.length > 0;
    el.grade.hidden = resultados.length === 0;
    el.mais.hidden = resultados.length <= limite;
    el.contagem.textContent = `${resultados.length} ${resultados.length === 1 ? "documento encontrado" : "documentos encontrados"}`;
    activeFiltersMarkup(state);
    updateSelectionBar();
    writeUrl(state);
  }

  function clearAll() {
    const currentView = activeView;
    colecaoAtiva = null;
    el.busca.value = "";
    el.assunto.value = "";
    updateSubsubjects();
    el.subassunto.value = "";
    el.tipo.value = "";
    el.publicacao.value = "";
    el.ano.value = "";
    el.qualidade.value = "";
    el.ordenacao.value = "titulo";
    render(true);
    if (currentView !== "biblioteca") showAppView(currentView);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("toast--visible");
    toastTimer = setTimeout(() => el.toast.classList.remove("toast--visible"), 1800);
  }

  function selectedRecords() {
    return catalogo
      .filter(record => selecionados.has(record.id))
      .sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR", { sensitivity: "base" }));
  }

  function updateSelectionBar() {
    const count = selecionados.size;
    el.exportacao.hidden = !selectionMode;
    el.selecaoContagem.textContent = `${count} ${count === 1 ? "documento selecionado" : "documentos selecionados"}`;
    el.compararSelecao.disabled = count < 2 || count > 4;
    el.copiarSelecao.disabled = count === 0;
    el.baixarSelecao.disabled = count === 0;
    document.body.classList.toggle("selection-mode", selectionMode);
    el.toggleSelectionMode.setAttribute("aria-pressed", String(selectionMode));
    el.toggleSelectionMode.textContent = selectionMode ? "Encerrar seleção" : "Selecionar";
  }

  function updateDensity() {
    document.body.classList.toggle("compact-cards", compactCards);
    if (!el.toggleDensity) return;
    el.toggleDensity.setAttribute("aria-pressed", String(compactCards));
    el.toggleDensity.textContent = compactCards ? "Espaçar cartões" : "Compactar";
  }

  function exportText(records, formatName) {
    const separator = formatName === "bibtex" ? "\n\n" : "\n\n";
    return records.map(record => citacoes.format(record, formatName)).join(separator).trim() + "\n";
  }

  function safeFilename(value) {
    return normalize(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 72) || "referencia";
  }

  function downloadText(value, filename, formatName) {
    const blob = new Blob([value], { type: formatName === "bibtex" ? "application/x-bibtex;charset=utf-8" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function batchFilename(formatName) {
    const date = new Date().toISOString().slice(0, 10);
    return `bibliografia-${date}.${citacoes.extension(formatName)}`;
  }

  function bibField(record, field) {
    const match = String(record.bibtex || "").match(
      new RegExp(`${field}\\s*=\\s*(?:\\{([^}]*)\\}|"([^"]*)")`, "i")
    );
    return (match?.[1] || match?.[2] || "").trim();
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function sameExternalUrl(first, second) {
    return Boolean(first && second && first.replace(/\/$/, "") === second.replace(/\/$/, ""));
  }

  function officialLinks(record) {
    const doi = bibField(record, "doi").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    const doiUrl = doi ? safeExternalUrl(`https://doi.org/${doi}`) : "";
    const bibUrl = safeExternalUrl(bibField(record, "url"));
    const explicitPageUrl = safeExternalUrl(record.officialPageUrl);
    const fullTextUrl = safeExternalUrl(record.officialFullTextUrl);
    return {
      doi,
      doiUrl,
      bibUrl,
      explicitPageUrl,
      pageUrl: explicitPageUrl || bibUrl,
      fullTextUrl,
      source: record.officialLinkSource || "",
      sourceUrl: safeExternalUrl(record.officialLinkSourceUrl),
      verifiedAt: record.officialLinkVerifiedAt || "",
    };
  }

  function onlineAvailability(record) {
    const links = officialLinks(record);
    if (links.fullTextUrl) return { kind: "fulltext", label: "Leitura online" };
    if (links.explicitPageUrl) return { kind: "page", label: "Página oficial" };
    return null;
  }

  function quickPreviewMarkup(record) {
    const authors = record.autores?.length ? record.autores.join("; ") : "Autoria não identificada";
    const official = officialLinks(record);
    const accessUrl = official.fullTextUrl || official.explicitPageUrl;
    const accessLabel = official.fullTextUrl ? "Ler online ↗" : "Página oficial ↗";
    const bibLabels = { verificado: "Verificado", estrutural: "Não verificado", pendente: "Pendente" };
    return `
      <div class="quick-preview__heading">
        <div>
          <p class="eyebrow">Ficha rápida</p>
          <h3>${escapeHtml(record.titulo)}</h3>
        </div>
        <button class="quick-preview__close" type="button" data-preview-close aria-label="Fechar ficha rápida">×</button>
      </div>
      <p class="quick-preview__authors">${escapeHtml(authors)}</p>
      <dl class="quick-preview__facts">
        <div><dt>Tipo</dt><dd>${escapeHtml(record.tipo || "Não identificado")}</dd></div>
        <div><dt>Ano</dt><dd>${escapeHtml(record.ano || "Não identificado")}</dd></div>
        <div><dt>Páginas</dt><dd>${escapeHtml(record.paginas || "Não disponível")}</dd></div>
        <div><dt>Qualidade</dt><dd>${escapeHtml(bibLabels[record.bibStatus] || "Pendente")}</dd></div>
      </dl>
      <div class="quick-preview__publication">
        <span>Publicação</span>
        <strong>${escapeHtml(record.publicacao || "Não identificada")}</strong>
      </div>
      <div class="quick-preview__actions">
        ${accessUrl ? `<a class="button" href="${escapeHtml(accessUrl)}" target="_blank" rel="noreferrer">${accessLabel}</a>` : ""}
        <button class="button button--quiet" type="button" data-open="${escapeHtml(record.id)}">Abrir ficha completa</button>
      </div>
      <p class="quick-preview__hint">A ficha completa reúne metadados, relações, citações e formatos bibliográficos.</p>`;
  }

  function closePreview() {
    previewedId = "";
    if (el.preview) {
      el.preview.hidden = true;
      el.preview.innerHTML = "";
    }
    el.resultsWorkspace?.classList.remove("results-workspace--preview");
    document.querySelectorAll(".book-card--previewed").forEach(card => card.classList.remove("book-card--previewed"));
  }

  function openPreview(id) {
    if (window.matchMedia("(max-width: 1180px)").matches) {
      openDetails(id);
      return;
    }
    const record = catalogo.find(item => item.id === id);
    if (!record || !el.preview) return;
    previewedId = id;
    el.preview.innerHTML = quickPreviewMarkup(record);
    el.preview.hidden = false;
    el.resultsWorkspace?.classList.add("results-workspace--preview");
    document.querySelectorAll(".book-card").forEach(card => {
      card.classList.toggle("book-card--previewed", card.querySelector(`[data-preview="${CSS.escape(id)}"]`) !== null);
    });
  }

  function bibliographicRows(record) {
    const edition = bibField(record, "edition");
    const volume = bibField(record, "volume");
    const number = bibField(record, "number");
    const isbn = bibField(record, "isbn");
    const eprint = bibField(record, "eprint");
    const links = officialLinks(record);
    const rows = [
      ["Ano", record.ano
        ? `<button class="metadata-filter" type="button" data-filter-year="${escapeHtml(record.ano)}">${escapeHtml(record.ano)}</button>`
        : "Não identificado"],
      ["Páginas", record.paginas ?? "Não disponível"],
      ["Publicação", record.publicacao
        ? `<button class="metadata-filter" type="button" data-filter-publication="${escapeHtml(record.publicacao)}">${escapeHtml(record.publicacao)}</button>`
        : "Não identificada no BibTeX"],
    ];
    if (edition) rows.push(["Edição", escapeHtml(edition)]);
    if (volume || number) rows.push(["Volume / número", escapeHtml([volume, number].filter(Boolean).join(" / "))]);
    if (links.doi) {
      rows.push(["DOI", links.doiUrl ? `<a class="metadata-link" href="${escapeHtml(links.doiUrl)}" target="_blank" rel="noreferrer">${escapeHtml(links.doi)}</a>` : escapeHtml(links.doi)]);
    }
    if (isbn) rows.push(["ISBN", escapeHtml(isbn)]);
    if (eprint) rows.push(["Identificador", escapeHtml(`arXiv:${eprint}`)]);
    if (links.pageUrl && !sameExternalUrl(links.pageUrl, links.doiUrl)) {
      rows.push(["Página oficial", `<a class="metadata-link" href="${escapeHtml(links.pageUrl)}" target="_blank" rel="noreferrer">Abrir fonte</a>`]);
    }
    if (links.fullTextUrl) {
      rows.push(["Texto completo", `<a class="metadata-link" href="${escapeHtml(links.fullTextUrl)}" target="_blank" rel="noreferrer">Abrir acesso online</a>`]);
    }
    if (links.bibUrl
      && !sameExternalUrl(links.bibUrl, links.pageUrl)
      && !sameExternalUrl(links.bibUrl, links.fullTextUrl)
      && !sameExternalUrl(links.bibUrl, links.doiUrl)) {
      rows.push(["Link bibliográfico", `<a class="metadata-link" href="${escapeHtml(links.bibUrl)}" target="_blank" rel="noreferrer">Abrir referência</a>`]);
    }
    return rows.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("");
  }

  function detailContextMarkup(context) {
    if (!context) {
      return `
        <section class="library-context library-context--empty" data-library-context>
          <div><p class="eyebrow">Descoberta local</p><h3>Contexto na biblioteca</h3></div>
          <p>Não foi possível obter o contexto de afinidade desta obra.</p>
        </section>`;
    }
    if (context.status === "unassigned") {
      const nearest = context.nearest;
      return `
        <section class="library-context library-context--empty" data-library-context>
          <div class="library-context__heading">
            <div><p class="eyebrow">Descoberta local</p><h3>Sem coleção confiável</h3></div>
            <span class="affinity-confidence affinity-confidence--exploratoria">Não agrupada</span>
          </div>
          <p>O sistema preservou esta obra fora das coleções porque nenhum vínculo ultrapassou o limiar mínimo de 25% dentro do corte sugerido.</p>
          ${nearest ? `<p class="library-context__nearest"><strong>Candidato mais próximo:</strong> <button type="button" data-open="${escapeHtml(nearest.id)}">${escapeHtml(nearest.title)}</button> · ${Math.round(nearest.similarity * 100)}% · ${escapeHtml(nearest.reasons.join(", "))}</p>` : ""}
        </section>`;
    }
    return `
      <section class="library-context" data-library-context>
        <div class="library-context__heading">
          <div><p class="eyebrow">Descoberta local · ${escapeHtml(context.code)}</p><h3>${escapeHtml(context.title)}</h3></div>
          <span class="affinity-confidence affinity-confidence--${escapeHtml(context.level.code)}">${escapeHtml(context.level.label)}</span>
        </div>
        <div class="library-context__summary">
          <div><span>Vínculo mais forte</span><strong>${Math.round(context.proximity * 100)}%</strong></div>
          <p>${context.size} obras nesta coleção · representante: <button type="button" data-open="${escapeHtml(context.representative.id)}">${escapeHtml(context.representative.titulo)}</button></p>
        </div>
        <p class="library-context__evidence"><strong>Base observada:</strong> ${escapeHtml(context.evidence.join(" · "))}</p>
        <div class="library-context__related">
          <h4>Obras mais próximas</h4>
          <ol>
            ${context.related.map(item => `
              <li>
                <button type="button" data-open="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button>
                <span>${Math.round(item.similarity * 100)}% · ${escapeHtml(item.reasons.join(", "))}</span>
              </li>`).join("")}
          </ol>
        </div>
        <div class="library-context__footer">
          <p>Indicador comparativo local; não representa probabilidade nem comprovação bibliográfica.</p>
          <button class="button button--quiet" type="button" data-family-filter="${escapeHtml(context.id)}">Ver coleção no catálogo</button>
        </div>
      </section>`;
  }

  function loadingContextMarkup() {
    return `
      <section class="library-context library-context--loading" data-library-context aria-live="polite">
        <div><p class="eyebrow">Descoberta local</p><h3>Contexto na biblioteca</h3></div>
        <p>Calculando a coleção sugerida e as obras mais próximas…</p>
      </section>`;
  }

  function detailMarkup(record) {
    const authors = record.autores?.length ? record.autores.join("; ") : "Autoria não identificada";
    const missing = record.bibIncompleto || [];
    const network = rede?.summary(record.id) || { cited: 0, citedBy: 0, total: 0 };
    const networkInScope = rede?.includes(record.id) || false;
    const networkScope = rede?.scopeLabel(record.id) || "";
    const affinity = afinidade?.summary(record.id) || { traceable: false, references: null, related: 0 };
    const bib = qualidade?.bibStatus(record) || { code: "estrutural", label: "Completo não verificado", detail: record.bibFonte || "" };
    const official = officialLinks(record);
    const qualityIssues = (qualidade?.issues(record) || [])
      .filter(issue => !issue.startsWith("bib-"))
      .filter(issue => !["referencias-nao-detectadas", "afinidade-nao-calculavel"].includes(issue));
    const networkBibliography = network.bibliographyState === "not_found"
      ? "Sem seção bibliográfica formal detectada neste PDF."
      : Number.isInteger(network.referencesFound)
        ? `${network.referencesFound} referências identificadas na bibliografia do PDF.`
        : "";
    const affinityDescription = affinity.traceable
      ? `${affinity.references ?? 0} referências rastreadas · ${affinity.related} ${affinity.related === 1 ? "obra relacionada" : "obras relacionadas"}`
      : affinity.message || "Não foi possível calcular afinidade por referências compartilhadas.";
    const hasNetworkRelations = networkInScope && network.total > 0;
    const hasAffinityRelations = affinity.available && affinity.traceable && affinity.related > 0;
    const relationEmptyMessage = network.bibliographyState === "not_found"
      ? "Nenhuma relação por citações foi confirmada. O extrator não detectou uma seção bibliográfica formal neste PDF; isso pode ser normal para este tipo de material."
      : affinity.traceable
        ? "A bibliografia foi rastreada, mas não houve sobreposição suficiente com outras obras da base."
        : "Nenhuma relação por citações foi confirmada e a afinidade por referências não pôde ser calculada.";
    const sequence = resultados.length ? resultados : catalogo;
    const position = sequence.findIndex(item => item.id === record.id);
    const previous = position > 0 ? sequence[position - 1] : null;
    const next = position >= 0 && position < sequence.length - 1 ? sequence[position + 1] : null;
    const abstract = record.resumo || record.abstract || "";
    return `
      <article class="detail">
        <div class="detail__visual">
          <div class="detail__visual-inner">
            ${coverMarkup(record, "detail__cover")}
            <p>${escapeHtml(record.nomeArquivo)}</p>
          </div>
        </div>
        <div class="detail__content">
          <p class="eyebrow">${escapeHtml(record.assunto)} · ${escapeHtml(record.subassunto)}</p>
          <h2>${escapeHtml(record.titulo)}</h2>
          <p class="detail__authors">${record.autores?.length
            ? record.autores.map(author => `<button type="button" data-filter-author="${escapeHtml(author)}">${escapeHtml(author)}</button>`).join("; ")
            : escapeHtml(authors)}</p>
          <div class="detail__chips">
            <button class="meta-chip" type="button" data-filter-subject="${escapeHtml(record.assunto)}">${escapeHtml(record.assunto)}</button>
            <button class="meta-chip" type="button" data-filter-subsubject="${escapeHtml(record.subassunto)}">${escapeHtml(record.subassunto)}</button>
            <span class="meta-chip">${escapeHtml(record.tipo)}</span>
            <span class="meta-chip bib-state bib-state--${escapeHtml(bib.code)}">${escapeHtml(bib.label)}</span>
          </div>
          <div class="detail-navigation" aria-label="Navegação entre documentos">
            <button type="button" data-detail-prev="${escapeHtml(previous?.id || "")}" ${previous ? "" : "disabled"}>← Anterior</button>
            <span>${position >= 0 ? position + 1 : 1} de ${sequence.length}</span>
            <button type="button" data-detail-next="${escapeHtml(next?.id || "")}" ${next ? "" : "disabled"}>Próximo →</button>
            <button type="button" data-copy-link>Copiar link</button>
          </div>
          <div class="detail-tabs" role="tablist" aria-label="Seções da ficha">
            <button id="detalhes-tab-ficha" type="button" role="tab" data-detail-tab="ficha" aria-controls="detalhes-painel-ficha" aria-selected="true" tabindex="0">Ficha</button>
            <button id="detalhes-tab-relacoes" type="button" role="tab" data-detail-tab="relacoes" aria-controls="detalhes-painel-relacoes" aria-selected="false" tabindex="-1">Relacionados</button>
            <button id="detalhes-tab-citacao" type="button" role="tab" data-detail-tab="citacao" aria-controls="detalhes-painel-citacao" aria-selected="false" tabindex="-1">Citação</button>
          </div>
          <div id="detalhes-painel-ficha" class="detail-panel" role="tabpanel" aria-labelledby="detalhes-tab-ficha" data-detail-panel="ficha">
            <section class="detail-section detail-section--metadata" aria-labelledby="metadata-title">
              <div class="detail-section__heading">
                <p class="eyebrow">Ficha catalográfica</p>
                <h3 id="metadata-title">Identificação bibliográfica</h3>
              </div>
              <dl class="metadata">${bibliographicRows(record)}</dl>
            </section>
            ${abstract ? `<section class="detail-section detail-abstract"><div class="detail-section__heading"><p class="eyebrow">Conteúdo</p><h3>Resumo</h3></div><p>${escapeHtml(abstract)}</p></section>` : ""}
            <details class="file-details">
              <summary>Arquivo, localização e tags</summary>
              <dl class="metadata metadata--technical">
                <dt>Arquivo</dt><dd>${escapeHtml(record.nomeArquivo)}</dd>
                <dt>Tags</dt><dd>${escapeHtml((record.tags || []).join(", ") || "Sem tags")}</dd>
              </dl>
            </details>
            <div class="detail__actions"><span class="quality-inline">PDFs e notas ficam disponíveis apenas na biblioteca local.</span></div>
            ${(official.fullTextUrl || official.explicitPageUrl) ? `<p class="official-link-evidence"><strong>Origem do acesso:</strong> ${official.sourceUrl ? `<a href="${escapeHtml(official.sourceUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(official.source || "fonte consultada")}</strong></a>` : `<strong>${escapeHtml(official.source || "fonte consultada")}</strong>`}${official.verifiedAt ? ` · verificado em ${escapeHtml(official.verifiedAt)}` : ""}.</p>` : ""}
            ${qualityIssues.length ? `<p class="quality-inline"><strong>Revisar:</strong> ${qualityIssues.map(issue => escapeHtml(qualidade.label(issue))).join(" · ")}</p>` : ""}
          </div>
          <div id="detalhes-painel-relacoes" class="detail-panel" role="tabpanel" aria-labelledby="detalhes-tab-relacoes" data-detail-panel="relacoes" hidden>
            ${loadingContextMarkup()}
            ${hasNetworkRelations || hasAffinityRelations ? `
              <section class="detail-section relations-section" aria-labelledby="relations-title">
                <div class="detail-section__heading">
                  <p class="eyebrow">Evidência bibliográfica</p>
                  <h3 id="relations-title">Relações confirmadas</h3>
                </div>
                <div class="relations-grid">
                  ${hasNetworkRelations ? `<article class="network-summary"><div><p class="eyebrow">Citações locais diretas · ${escapeHtml(networkScope)}</p><h3>Relações bibliográficas</h3>${networkBibliography ? `<p>${escapeHtml(networkBibliography)}</p>` : ""}<p>${network.cited} citadas · ${network.citedBy} citam esta fonte</p></div><button class="button" type="button" data-open-network="${escapeHtml(record.id)}">Explorar citações</button></article>` : ""}
                  ${hasAffinityRelations ? `<article class="network-summary network-summary--affinity"><div><p class="eyebrow">Referências compartilhadas</p><h3>Mapa de afinidade</h3><p>${escapeHtml(affinityDescription)}</p></div><button class="button" type="button" data-open-affinity="${escapeHtml(record.id)}">Explorar afinidades</button></article>` : ""}
                </div>
              </section>` : `<aside class="relation-empty"><div class="relation-empty__mark" aria-hidden="true">↔</div><div><p class="eyebrow">Relações confirmadas</p><h3>Nenhuma conexão local disponível</h3><p>${escapeHtml(relationEmptyMessage)}</p></div></aside>`}
          </div>
          <div id="detalhes-painel-citacao" class="detail-panel" role="tabpanel" aria-labelledby="detalhes-tab-citacao" data-detail-panel="citacao" hidden>
            <div class="bib-heading">
              <div>
                <h3 data-citation-title>Referência em BibTeX</h3>
                <p class="bib-source">${escapeHtml(bib.label)} · ${escapeHtml(bib.detail || record.bibFonte || "metadados do catálogo")}${record.bibId ? ` · ${escapeHtml(record.bibId)}` : ""}</p>
              </div>
            </div>
            <div class="citation-toolbar">
              <div class="citation-formats" role="group" aria-label="Formato da referência">
                <button type="button" data-citation-format="bibtex" aria-pressed="true">BibTeX</button>
                <button type="button" data-citation-format="apa" aria-pressed="false">APA</button>
                <button type="button" data-citation-format="abnt" aria-pressed="false">ABNT</button>
              </div>
              <div class="citation-actions">
                <button class="copy-button" type="button" data-copy-citation>Copiar</button>
                <button class="copy-button" type="button" data-download-citation>Baixar</button>
              </div>
            </div>
            <pre class="bibtex"><code data-citation-output>${escapeHtml(citacoes.format(record, "bibtex"))}</code></pre>
            ${missing.length ? `<p class="bib-warning">Registro mínimo. Campos ainda ausentes: ${escapeHtml(missing.join(", "))}.</p>` : ""}
          </div>
        </div>
      </article>`;
  }

  function documentLink(id) {
    const url = new URL(location.href);
    url.hash = `documento=${encodeURIComponent(id)}`;
    return url.href;
  }

  function setDocumentHash(id) {
    try {
      history.replaceState(null, "", documentLink(id));
    } catch {
      // Páginas file:// podem limitar alterações no histórico.
    }
  }

  function clearDocumentHash() {
    if (!location.hash.startsWith("#documento=")) return;
    try {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    } catch {
      // Páginas file:// podem limitar alterações no histórico.
    }
  }

  function closeDetails() {
    if (el.dialog.open) el.dialog.close();
    clearDocumentHash();
  }

  function switchDetailTab(name) {
    el.conteudo.querySelectorAll("[data-detail-tab]").forEach(button => {
      const selected = button.dataset.detailTab === name;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    el.conteudo.querySelectorAll("[data-detail-panel]").forEach(panel => {
      panel.hidden = panel.dataset.detailPanel !== name;
    });
  }

  function openDetails(id, updateHash = true) {
    const record = catalogo.find(item => item.id === id);
    if (!record) return;
    document.querySelectorAll("dialog[open]").forEach(item => {
      if (item !== el.dialog) item.close();
    });
    el.conteudo.innerHTML = detailMarkup(record);
    el.dialog.dataset.current = id;
    el.dialog.dataset.citationFormat = "bibtex";
    if (!el.dialog.open) el.dialog.showModal();
    if (updateHash) setDocumentHash(id);
    window.setTimeout(() => {
      if (el.dialog.dataset.current !== id) return;
      const target = el.conteudo.querySelector("[data-library-context]");
      if (!target) return;
      try {
        target.outerHTML = detailContextMarkup(dendrograma?.context?.(id) || null);
      } catch {
        target.outerHTML = detailContextMarkup(null);
      }
    }, 0);
  }

  function openNetwork(id, direction = "both") {
    if (!rede || !el.redeDialog) return;
    if (el.dialog.open) el.dialog.close();
    el.redeDialog.dataset.current = id;
    el.redeDialog.dataset.direction = direction;
    el.redeDialog.dataset.view = "citations";
    el.redeConteudo.innerHTML = rede.render(id, direction);
    if (!el.redeDialog.open) el.redeDialog.showModal();
  }

  function openAffinity(id) {
    if (!afinidade || !el.redeDialog) return;
    if (el.dialog.open) el.dialog.close();
    el.redeDialog.dataset.current = id;
    el.redeDialog.dataset.view = "affinity";
    el.redeConteudo.innerHTML = afinidade.render(id);
    if (!el.redeDialog.open) el.redeDialog.showModal();
  }

  function openDendrogram(forceSelection = false) {
    if (!dendrograma?.available || !el.dendrogramaDialog) {
      showToast("Agrupamento indisponível");
      return;
    }
    const manual = selectedRecords();
    const useSelection = forceSelection;
    const records = useSelection ? manual : resultados;
    if (records.length < 2) {
      showToast(useSelection ? "Selecione pelo menos dois documentos" : "O filtro precisa retornar pelo menos dois documentos");
      return;
    }
    document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
    el.dendrogramaDialog.showModal();
    const state = stateFromControls();
    const filtered = state.q || state.assunto || state.subassunto || state.tipo || state.publicacao || state.ano || state.qualidade || colecaoAtiva;
    const sourceLabel = useSelection ? "Seleção manual" : filtered ? "Filtro atual" : "Catálogo completo";
    dendrograma.mount(el.dendrogramaConteudo, records, { sourceLabel });
  }

  function renderRelationsPage(id) {
    const record = catalogo.find(item => item.id === id) || catalogo[0];
    if (!record || !el.relacoesResumo) return;
    const network = rede?.summary(record.id) || { cited: 0, citedBy: 0, total: 0 };
    const affinitySummary = afinidade?.summary(record.id) || { traceable: false, references: 0, related: 0 };
    const context = dendrograma?.context?.(record.id) || null;
    const collection = context?.status === "grouped"
      ? `${context.code} · ${context.title}`
      : "Sem coleção confiável";
    el.relacoesResumo.innerHTML = `
      <article class="relations-focus">
        <p class="eyebrow">Obra central</p>
        <h3>${escapeHtml(record.titulo)}</h3>
        <p>${escapeHtml((record.autores || []).join("; ") || "Autoria não identificada")}</p>
        <button class="button button--quiet" type="button" data-open="${escapeHtml(record.id)}">Abrir ficha</button>
      </article>
      <div class="relation-type-grid">
        <article class="relation-type relation-type--citation">
          <span>Citação direta</span>
          <strong>${network.total || 0}</strong>
          <p>${network.cited || 0} citadas por esta obra · ${network.citedBy || 0} citam esta obra.</p>
          ${network.total ? `<button class="button" type="button" data-open-network="${escapeHtml(record.id)}">Explorar citações</button>` : `<small>Nenhuma ligação direta confirmada na base local.</small>`}
        </article>
        <article class="relation-type relation-type--shared">
          <span>Referências compartilhadas</span>
          <strong>${affinitySummary.related || 0}</strong>
          <p>${affinitySummary.traceable ? `${affinitySummary.references || 0} referências rastreadas nesta obra.` : "Bibliografia insuficiente para comparar."}</p>
          ${affinitySummary.traceable && affinitySummary.related ? `<button class="button" type="button" data-open-affinity="${escapeHtml(record.id)}">Explorar afinidade</button>` : `<small>Sem sobreposição bibliográfica calculável.</small>`}
        </article>
        <article class="relation-type relation-type--metadata">
          <span>Afinidade por metadados</span>
          <strong>${context?.status === "grouped" ? `${Math.round(context.proximity * 100)}%` : "—"}</strong>
          <p>${escapeHtml(collection)}</p>
          ${context?.status === "grouped" ? `<button class="button button--quiet" type="button" data-family-filter="${escapeHtml(record.id)}">Ver coleção</button>` : `<small>Nenhum vínculo ultrapassou o limiar mínimo.</small>`}
        </article>
      </div>`;
  }

  function showAppView(view) {
    activeView = ["biblioteca", "colecoes", "relacoes", "qualidade"].includes(view) ? view : "biblioteca";
    const views = {
      biblioteca: el.bibliotecaView,
      colecoes: el.colecoesView,
      relacoes: el.relacoesView,
      qualidade: el.qualidadeView,
    };
    Object.entries(views).forEach(([name, target]) => {
      if (target) target.hidden = name !== activeView;
    });
    document.querySelectorAll("[data-app-view]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.appView === activeView));
    });
    if (activeView === "colecoes" && dendrograma?.available && el.colecoesPage) {
      const state = stateFromControls();
      const filtered = state.q || state.assunto || state.subassunto || state.tipo || state.publicacao || state.ano || state.qualidade || colecaoAtiva;
      const records = filtered ? resultados : catalogo;
      if (records.length < 2) {
        el.colecoesPage.innerHTML = `<header class="page-header"><p class="eyebrow">Organização por afinidade</p><h2>Coleções sugeridas</h2></header><div class="empty-state"><h3>O recorte atual não pode ser agrupado.</h3><p>São necessários pelo menos dois documentos. Amplie ou limpe os filtros da biblioteca.</p><button class="button" type="button" data-app-view="biblioteca">Voltar à biblioteca</button></div>`;
      } else {
        dendrograma.mount(el.colecoesPage, records, { sourceLabel: filtered ? "Filtro atual" : "Catálogo completo" });
      }
    }
    if (activeView === "relacoes") renderRelationsPage(el.relacoesDocumento?.value);
    if (activeView === "qualidade") qualidade?.renderInto?.(el.qualidadePage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function comparisonMarkup(records) {
    const rows = [
      ["Título", record => record.titulo || "—"],
      ["Autoria", record => (record.autores || []).join("; ") || "—"],
      ["Ano", record => record.ano || "—"],
      ["Publicação", record => record.publicacao || "—"],
      ["Tipo", record => record.tipo || "—"],
      ["Assunto", record => [record.assunto, record.subassunto].filter(Boolean).join(" · ") || "—"],
      ["Páginas", record => record.paginas || "—"],
      ["BibTeX", record => qualidade?.bibStatus(record).label || "—"],
      ["Coleção sugerida", record => {
        const context = dendrograma?.context?.(record.id);
        return context?.status === "grouped" ? `${context.code} · ${context.title}` : "Sem coleção confiável";
      }],
    ];
    return `
      <header class="comparison-header">
        <p class="eyebrow">Leitura lado a lado</p>
        <h2>Comparar documentos</h2>
        <p>${records.length} obras selecionadas. A comparação usa somente os dados disponíveis no catálogo local.</p>
      </header>
      <div class="comparison-table-wrap">
        <table class="comparison-table">
          <thead><tr><th>Campo</th>${records.map(record => `<th><button type="button" data-open="${escapeHtml(record.id)}">${escapeHtml(record.titulo)}</button></th>`).join("")}</tr></thead>
          <tbody>${rows.map(([label, read]) => `<tr><th>${escapeHtml(label)}</th>${records.map(record => `<td>${escapeHtml(read(record))}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
  }

  function openComparison() {
    const records = selectedRecords();
    if (records.length < 2 || records.length > 4) {
      showToast("Selecione de 2 a 4 documentos para comparar");
      return;
    }
    el.comparacaoConteudo.innerHTML = comparisonMarkup(records);
    if (!el.comparacaoDialog.open) el.comparacaoDialog.showModal();
  }

  function updateDetailCitation(formatName) {
    const record = catalogo.find(item => item.id === el.dialog.dataset.current);
    if (!record) return;
    el.dialog.dataset.citationFormat = formatName;
    el.conteudo.querySelectorAll("[data-citation-format]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.citationFormat === formatName));
    });
    el.conteudo.querySelector("[data-citation-title]").textContent = `Referência em ${citacoes.label(formatName)}`;
    el.conteudo.querySelector("[data-citation-output]").textContent = citacoes.format(record, formatName);
  }

  function applyDetailFilter(field, value) {
    el.dialog.close();
    clearDocumentHash();
    showAppView("biblioteca");
    if (field === "assunto") {
      el.assunto.value = value;
      updateSubsubjects();
      el.subassunto.value = "";
    } else {
      const record = catalogo.find(item => item.id === el.dialog.dataset.current);
      if (record) {
        el.assunto.value = record.assunto;
        updateSubsubjects();
      }
      el.subassunto.value = value;
    }
    render(true);
    document.querySelector("#resultados").scrollIntoView({ behavior: "smooth" });
  }

  async function copyText(value, success) {
    try {
      await navigator.clipboard.writeText(value);
      showToast(success);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      showToast(success);
    }
  }

  function initialize() {
    colecaoAtiva = null;
    fillSelect(el.assunto, uniqueSorted(catalogo.map(item => item.assunto)), "Todos os assuntos", countsBy(catalogo, "assunto"));
    fillSelect(el.tipo, uniqueSorted(catalogo.map(item => item.tipo)), "Todos os tipos", countsBy(catalogo, "tipo"));
    fillSelect(el.publicacao, uniqueSorted(catalogo.map(item => item.publicacao)), "Todas as publicações", countsBy(catalogo, "publicacao"));
    fillSelect(el.ano, uniqueSorted(catalogo.map(item => item.ano)).sort((a, b) => b.localeCompare(a)), "Todos os anos", countsBy(catalogo, "ano"));
    const qualityValues = [
        "bib-verificado",
        "bib-estrutural",
        "bib-pendente",
        "pdf-falha",
        "sem-capa",
        "sem-texto-pesquisavel",
        "metadados-pendentes",
        "referencias-nao-detectadas",
        "afinidade-nao-calculavel",
        "duplicata-provavel",
      ];
    const qualityCounts = new Map(qualityValues.map(code => [
      code,
      catalogo.filter(record => qualidade?.matches(record, code)).length,
    ]));
    fillSelect(el.qualidade, qualityValues, "Todos os estados", qualityCounts);
    [...el.qualidade.options].forEach(option => {
      if (option.value) option.textContent = `${qualidade?.label(option.value) || option.value} (${qualityCounts.get(option.value) || 0})`;
    });
    if (el.relacoesDocumento) {
      el.relacoesDocumento.innerHTML = [...catalogo]
        .sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR", { sensitivity: "base" }))
        .map(record => `<option value="${escapeHtml(record.id)}">${escapeHtml(record.titulo)}</option>`)
        .join("");
    }

    const state = stateFromUrl();
    el.busca.value = state.q;
    el.assunto.value = state.assunto;
    updateSubsubjects();
    el.subassunto.value = state.subassunto;
    el.tipo.value = state.tipo;
    el.publicacao.value = state.publicacao;
    el.ano.value = state.ano;
    el.qualidade.value = state.qualidade;
    el.ordenacao.value = ["titulo", "autor", "assunto", "ano-desc", "ano-asc"].includes(state.ordem) ? state.ordem : "titulo";

    if (!["grid", "list", "table"].includes(layoutMode)) layoutMode = "grid";
    document.querySelectorAll("[data-layout]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.layout === layoutMode));
    });
    updateDensity();

    document.querySelector("#total-documentos").textContent = `${catalogo.length} documentos`;
    document.querySelector("#total-assuntos").textContent = `${uniqueSorted(catalogo.map(item => item.assunto)).length} assuntos`;
    document.querySelector("#atualizado-em").textContent = meta.geradoEm
      ? `Atualizado em ${new Date(meta.geradoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
      : "Dados locais";
    render(true);
    const documentId = location.hash.startsWith("#documento=")
      ? decodeURIComponent(location.hash.slice("#documento=".length))
      : "";
    if (documentId && catalogo.some(record => record.id === documentId)) {
      window.setTimeout(() => openDetails(documentId, false), 0);
    }
  }

  let debounce;
  el.busca.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => render(true), 120);
  });
  el.assunto.addEventListener("change", () => {
    updateSubsubjects();
    el.subassunto.value = "";
    render(true);
  });
  el.subassunto.addEventListener("change", () => render(true));
  el.tipo.addEventListener("change", () => render(true));
  el.publicacao.addEventListener("change", () => render(true));
  el.ano.addEventListener("change", () => render(true));
  el.qualidade.addEventListener("change", () => render(true));
  el.ordenacao.addEventListener("change", () => render(false));
  el.alternarFiltros?.addEventListener("click", () => {
    const expanded = el.alternarFiltros.getAttribute("aria-expanded") === "true";
    el.alternarFiltros.setAttribute("aria-expanded", String(!expanded));
    el.queryPanel?.classList.toggle("query-panel--filters-open", !expanded);
    const total = el.ativos.children.length;
    const label = expanded ? "Filtros" : "Ocultar filtros";
    el.alternarFiltros.textContent = total ? `${label} (${total})` : label;
  });
  el.limpar.addEventListener("click", clearAll);
  el.limparNav?.addEventListener("click", clearAll);
  el.toggleDensity?.addEventListener("click", () => {
    compactCards = !compactCards;
    writePreference("ebib-density", compactCards ? "compact" : "comfortable");
    updateDensity();
  });
  el.mais.addEventListener("click", () => {
    limite += pageSize;
    render(false);
  });
  el.selecionarExibidos.addEventListener("click", () => {
    resultados.slice(0, limite).forEach(record => selecionados.add(record.id));
    render(false);
    showToast("Documentos exibidos selecionados");
  });
  el.limparSelecao.addEventListener("click", () => {
    selecionados.clear();
    render(false);
  });
  el.copiarSelecao.addEventListener("click", () => {
    const records = selectedRecords();
    if (!records.length) return;
    const formatName = el.formatoExportacao.value;
    copyText(exportText(records, formatName), `${records.length} ${records.length === 1 ? "referência copiada" : "referências copiadas"}`);
  });
  el.baixarSelecao.addEventListener("click", () => {
    const records = selectedRecords();
    if (!records.length) return;
    const formatName = el.formatoExportacao.value;
    downloadText(exportText(records, formatName), batchFilename(formatName), formatName);
    showToast("Arquivo bibliográfico criado");
  });
  el.relacoesDocumento?.addEventListener("change", () => renderRelationsPage(el.relacoesDocumento.value));
  el.toggleSelectionMode.addEventListener("click", () => {
    selectionMode = !selectionMode;
    if (!selectionMode) selecionados.clear();
    render(false);
  });
  el.compararSelecao.addEventListener("click", openComparison);
  el.fecharComparacao?.addEventListener("click", () => el.comparacaoDialog.close());
  el.comparacaoDialog?.addEventListener("click", event => {
    if (event.target === el.comparacaoDialog) el.comparacaoDialog.close();
  });
  el.dendrogramaSelecao.addEventListener("click", () => openDendrogram(true));
  el.fechar.addEventListener("click", closeDetails);
  el.dialog.addEventListener("click", event => {
    if (event.target === el.dialog) closeDetails();
  });
  el.dialog.addEventListener("close", clearDocumentHash);
  el.fecharRede.addEventListener("click", () => el.redeDialog.close());
  el.redeDialog.addEventListener("click", event => {
    if (event.target === el.redeDialog) el.redeDialog.close();
  });
  el.fecharDendrograma.addEventListener("click", () => el.dendrogramaDialog.close());
  el.dendrogramaDialog.addEventListener("click", event => {
    if (event.target === el.dendrogramaDialog) el.dendrogramaDialog.close();
  });

  document.addEventListener("click", event => {
    const appView = event.target.closest("[data-app-view]");
    if (appView) showAppView(appView.dataset.appView);

    const layout = event.target.closest("[data-layout]");
    if (layout) {
      layoutMode = layout.dataset.layout;
      writePreference("ebib-layout", layoutMode);
      document.querySelectorAll("[data-layout]").forEach(button => {
        button.setAttribute("aria-pressed", String(button === layout));
      });
      render(false);
    }

    const preview = event.target.closest("[data-preview]");
    if (preview) openPreview(preview.dataset.preview);

    if (event.target.closest("[data-preview-close]")) closePreview();

    const open = event.target.closest("[data-open]");
    if (open) openDetails(open.dataset.open);

    const detailTab = event.target.closest("[data-detail-tab]");
    if (detailTab) switchDetailTab(detailTab.dataset.detailTab);
    const previous = event.target.closest("[data-detail-prev]");
    if (previous?.dataset.detailPrev) openDetails(previous.dataset.detailPrev);
    const next = event.target.closest("[data-detail-next]");
    if (next?.dataset.detailNext) openDetails(next.dataset.detailNext);
    if (event.target.closest("[data-copy-link]") && el.dialog.dataset.current) {
      copyText(documentLink(el.dialog.dataset.current), "Link da ficha copiado");
    }

    const clear = event.target.closest("[data-clear]");
    if (clear) clearAll();

    const remove = event.target.closest("[data-remove]");
    if (remove) {
      const field = remove.dataset.remove;
      if (field === "q") el.busca.value = "";
      if (field === "assunto") {
        el.assunto.value = "";
        updateSubsubjects();
        el.subassunto.value = "";
      }
      if (field === "subassunto") el.subassunto.value = "";
      if (field === "tipo") el.tipo.value = "";
      if (field === "publicacao") el.publicacao.value = "";
      if (field === "ano") el.ano.value = "";
      if (field === "qualidade") el.qualidade.value = "";
      if (field === "colecao") colecaoAtiva = null;
      render(true);
    }

    const subject = event.target.closest("[data-filter-subject]");
    if (subject) applyDetailFilter("assunto", subject.dataset.filterSubject);
    const subsubject = event.target.closest("[data-filter-subsubject]");
    if (subsubject) applyDetailFilter("subassunto", subsubject.dataset.filterSubsubject);
    const publication = event.target.closest("[data-filter-publication]");
    if (publication) {
      el.dialog.close();
      showAppView("biblioteca");
      el.publicacao.value = publication.dataset.filterPublication;
      render(true);
      document.querySelector("#resultados").scrollIntoView({ behavior: "smooth" });
    }
    const year = event.target.closest("[data-filter-year]");
    if (year) {
      el.dialog.close();
      showAppView("biblioteca");
      el.ano.value = year.dataset.filterYear;
      render(true);
      document.querySelector("#resultados").scrollIntoView({ behavior: "smooth" });
    }
    const author = event.target.closest("[data-filter-author]");
    if (author) {
      el.dialog.close();
      showAppView("biblioteca");
      el.busca.value = `autor:"${author.dataset.filterAuthor}"`;
      render(true);
      document.querySelector("#resultados").scrollIntoView({ behavior: "smooth" });
    }

    const qualityFilter = event.target.closest("[data-quality-filter]");
    if (qualityFilter && qualityFilter.closest("#qualidade-page")) {
      showAppView("biblioteca");
      el.qualidade.value = qualityFilter.dataset.qualityFilter;
      render(true);
      document.querySelector("#resultados").scrollIntoView({ behavior: "smooth" });
    }

    const networkOpen = event.target.closest("[data-open-network]");
    if (networkOpen) openNetwork(networkOpen.dataset.openNetwork);

    const affinityOpen = event.target.closest("[data-open-affinity]");
    if (affinityOpen) openAffinity(affinityOpen.dataset.openAffinity);

    const familyFilter = event.target.closest("[data-family-filter]");
    if (familyFilter) {
      const context = dendrograma?.context?.(familyFilter.dataset.familyFilter);
      if (context?.status === "grouped") {
        document.dispatchEvent(new CustomEvent("catalogo:apply-cluster", {
          detail: {
            ids: context.ids,
            label: `${context.code} · ${context.title}`,
          },
        }));
      }
    }

    const networkNode = event.target.closest("[data-network-node]");
    if (networkNode && el.redeDialog.open) {
      openNetwork(networkNode.dataset.networkNode, el.redeDialog.dataset.direction || "both");
    }

    const affinityNode = event.target.closest("[data-affinity-node]");
    if (affinityNode && el.redeDialog.open) {
      openAffinity(affinityNode.dataset.affinityNode);
    }

    const networkDirection = event.target.closest("[data-network-direction]");
    if (networkDirection && el.redeDialog.open) {
      openNetwork(el.redeDialog.dataset.current, networkDirection.dataset.networkDirection);
    }

    const networkDetail = event.target.closest("[data-network-detail]");
    if (networkDetail) {
      el.redeDialog.close();
      openDetails(networkDetail.dataset.networkDetail);
    }

    const citationFormat = event.target.closest("[data-citation-format]");
    if (citationFormat) updateDetailCitation(citationFormat.dataset.citationFormat);

    const current = catalogo.find(item => item.id === el.dialog.dataset.current);
    if (current && event.target.closest("[data-copy-citation]")) {
      const formatName = el.dialog.dataset.citationFormat || "bibtex";
      copyText(citacoes.format(current, formatName), `${citacoes.label(formatName)} copiado`);
    }
    if (current && event.target.closest("[data-download-citation]")) {
      const formatName = el.dialog.dataset.citationFormat || "bibtex";
      const filename = `${safeFilename(current.titulo)}.${citacoes.extension(formatName)}`;
      downloadText(citacoes.format(current, formatName) + "\n", filename, formatName);
      showToast("Referência baixada");
    }
  });

  document.addEventListener("change", event => {
    const checkbox = event.target.closest("[data-select]");
    if (!checkbox) return;
    selectionMode = true;
    if (checkbox.checked) selecionados.add(checkbox.dataset.select);
    else selecionados.delete(checkbox.dataset.select);
    checkbox.closest(".book-card")?.classList.toggle("book-card--selected", checkbox.checked);
    checkbox.closest("tr")?.classList.toggle("catalog-table__row--selected", checkbox.checked);
    updateSelectionBar();
  });

  document.addEventListener("catalogo:quality-filter", event => {
    showAppView("biblioteca");
    el.qualidade.value = event.detail?.value || "";
    render(true);
    document.querySelector("#resultados").scrollIntoView({ behavior: "smooth" });
  });

  document.addEventListener("catalogo:open-details", event => {
    const id = event.detail?.id;
    if (!id) return;
    if (el.dendrogramaDialog.open) el.dendrogramaDialog.close();
    openDetails(id);
  });

  document.addEventListener("catalogo:apply-cluster", event => {
    const ids = Array.isArray(event.detail?.ids) ? event.detail.ids : [];
    if (!ids.length) return;
    colecaoAtiva = {
      ids: new Set(ids),
      label: event.detail?.label || "Agrupamento local",
    };
    if (el.dendrogramaDialog.open) el.dendrogramaDialog.close();
    if (el.dialog.open) el.dialog.close();
    if (el.redeDialog.open) el.redeDialog.close();
    showAppView("biblioteca");
    render(true);
    document.querySelector("#resultados").scrollIntoView({ behavior: "smooth" });
    showToast(`${ids.length} ${ids.length === 1 ? "documento exibido" : "documentos exibidos"}`);
  });

  document.addEventListener("catalogo:select-cluster", event => {
    const ids = Array.isArray(event.detail?.ids) ? event.detail.ids : [];
    if (!ids.length) return;
    selecionados.clear();
    ids.forEach(id => selecionados.add(id));
    selectionMode = true;
    colecaoAtiva = {
      ids: new Set(ids),
      label: event.detail?.label || "Coleção sugerida",
    };
    showAppView("biblioteca");
    render(true);
    document.querySelector("#resultados").scrollIntoView({ behavior: "smooth" });
    showToast(`${ids.length} documentos selecionados`);
  });

  document.addEventListener("keydown", event => {
    const detailTab = event.target.closest?.("[data-detail-tab]");
    if (detailTab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const tabs = [...el.conteudo.querySelectorAll("[data-detail-tab]")];
      const current = tabs.indexOf(detailTab);
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      switchDetailTab(tabs[next].dataset.detailTab);
      tabs[next].focus();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && document.activeElement?.matches(".network-node")) {
      event.preventDefault();
      openNetwork(document.activeElement.dataset.networkNode, el.redeDialog.dataset.direction || "both");
    }
    if ((event.key === "Enter" || event.key === " ") && document.activeElement?.matches(".affinity-node")) {
      event.preventDefault();
      openAffinity(document.activeElement.dataset.affinityNode);
    }
    const active = document.activeElement;
    const editing = active?.matches("input, select, textarea, [contenteditable='true']");
    if (event.key === "/" && !editing && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      el.busca.focus();
    }
  });
  window.addEventListener("popstate", initialize);

  initialize();
})();
