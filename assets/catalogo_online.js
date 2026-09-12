(() => {
  "use strict";

  const catalogo = Array.isArray(window.CATALOGO) ? window.CATALOGO : [];
  const meta = window.CATALOGO_META || {};
  const citacoes = window.Citacoes;
  const rede = window.RedeCitacoes;
  const afinidade = window.MapaAfinidade;
  const qualidade = window.QualidadeBiblioteca;
  const pageSize = 48;
  let limite = pageSize;
  let resultados = [];
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
    limpar: document.querySelector("#limpar"),
    grade: document.querySelector("#grade"),
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
    redeDialog: document.querySelector("#rede-bibliografica"),
    redeConteudo: document.querySelector("#rede-conteudo"),
    fecharRede: document.querySelector("#fechar-rede"),
  };

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

  function fillSelect(select, values, label) {
    const current = select.value;
    select.innerHTML = `<option value="">${label}</option>` + values
      .map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
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
      "Todos os subassuntos"
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
    const bib = qualidade?.bibStatus(record) || {
      code: record.bibIncompleto?.length ? "pendente" : "estrutural",
      label: record.bibIncompleto?.length ? "Bib pendente" : "Completo não verificado",
    };
    return `
      <article class="book-card ${selecionados.has(record.id) ? "book-card--selected" : ""}">
        <label class="book-card__select">
          <input type="checkbox" data-select="${record.id}" ${selecionados.has(record.id) ? "checked" : ""}>
          <span>Selecionar</span>
        </label>
        <button class="book-card__button" type="button" data-open="${record.id}" aria-label="Ver detalhes de ${escapeHtml(record.titulo)}">
          <div class="cover-frame">${coverMarkup(record)}</div>
          <div class="book-card__body">
            <p class="book-card__subject">${escapeHtml(record.assunto)} · ${escapeHtml(record.subassunto)}</p>
            <h3>${escapeHtml(record.titulo)}</h3>
            <p class="book-card__authors">${escapeHtml(authors)}</p>
            <div class="book-card__footer">
              <span>${escapeHtml(record.tipo)}${record.paginas ? ` · ${record.paginas} p.` : ""}</span>
              <span class="bib-state bib-state--${escapeHtml(bib.code)}">${escapeHtml(bib.label)}</span>
            </div>
          </div>
        </button>
      </article>`;
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
    ].filter(([, value]) => value);
    el.ativos.innerHTML = filters.map(([field, value, label]) =>
      `<button type="button" class="filter-chip" data-remove="${field}">${escapeHtml(label)}: ${escapeHtml(value)} <span aria-hidden="true">×</span></button>`
    ).join("");
  }

  function render(reset = false) {
    if (reset) limite = pageSize;
    const state = stateFromControls();
    resultados = filterRecords(state);
    const visible = resultados.slice(0, limite);
    el.grade.innerHTML = visible.map(cardMarkup).join("");
    el.vazio.hidden = resultados.length > 0;
    el.grade.hidden = resultados.length === 0;
    el.mais.hidden = resultados.length <= limite;
    el.contagem.textContent = `${resultados.length} ${resultados.length === 1 ? "documento encontrado" : "documentos encontrados"}`;
    activeFiltersMarkup(state);
    updateSelectionBar();
    writeUrl(state);
  }

  function clearAll() {
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
    el.exportacao.hidden = count === 0;
    el.selecaoContagem.textContent = `${count} ${count === 1 ? "documento selecionado" : "documentos selecionados"}`;
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

  function detailMarkup(record) {
    const authors = record.autores?.length ? record.autores.join("; ") : "Autoria não identificada";
    const missing = record.bibIncompleto || [];
    const network = rede?.summary(record.id) || { cited: 0, citedBy: 0, total: 0 };
    const networkInScope = rede?.includes(record.id) || false;
    const networkScope = rede?.scopeLabel(record.id) || "";
    const affinity = afinidade?.summary(record.id) || { traceable: false, references: null, related: 0 };
    const bib = qualidade?.bibStatus(record) || { code: "estrutural", label: "Completo não verificado", detail: record.bibFonte || "" };
    const qualityIssues = (qualidade?.issues(record) || [])
      .filter(issue => !issue.startsWith("bib-"));
    const networkBibliography = network.bibliographyState === "not_found"
      ? "Sem seção bibliográfica formal detectada neste PDF."
      : Number.isInteger(network.referencesFound)
        ? `${network.referencesFound} referências identificadas na bibliografia do PDF.`
        : "";
    const affinityDescription = affinity.traceable
      ? `${affinity.references ?? 0} referências rastreadas · ${affinity.related} ${affinity.related === 1 ? "obra relacionada" : "obras relacionadas"}`
      : affinity.message || "Não foi possível calcular afinidade por referências compartilhadas.";
    return `
      <article class="detail">
        <div class="detail__visual">
          ${coverMarkup(record, "detail__cover")}
          <p>${escapeHtml(record.nomeArquivo)}</p>
        </div>
        <div class="detail__content">
          <p class="eyebrow">${escapeHtml(record.assunto)} · ${escapeHtml(record.subassunto)}</p>
          <h2>${escapeHtml(record.titulo)}</h2>
          <p class="detail__authors">${escapeHtml(authors)}</p>
          <div class="detail__chips">
            <button class="meta-chip" type="button" data-filter-subject="${escapeHtml(record.assunto)}">${escapeHtml(record.assunto)}</button>
            <button class="meta-chip" type="button" data-filter-subsubject="${escapeHtml(record.subassunto)}">${escapeHtml(record.subassunto)}</button>
            <span class="meta-chip">${escapeHtml(record.tipo)}</span>
            <span class="meta-chip bib-state bib-state--${escapeHtml(bib.code)}">${escapeHtml(bib.label)}</span>
          </div>
          <dl class="metadata">
            <dt>Ano</dt><dd>${escapeHtml(record.ano || "Não identificado")}</dd>
            <dt>Páginas</dt><dd>${record.paginas ?? "Não disponível"}</dd>
            <dt>Arquivo</dt><dd>${escapeHtml(record.nomeArquivo)}</dd>
            <dt>Publicação</dt><dd>${escapeHtml(record.publicacao || "Não identificada no BibTeX")}</dd>
            <dt>Tags</dt><dd>${escapeHtml((record.tags || []).join(", ") || "Sem tags")}</dd>
          </dl>
          <div class="detail__actions"><span class="quality-inline">PDFs e notas ficam disponíveis apenas na biblioteca local.</span></div>
          ${qualityIssues.length ? `<p class="quality-inline"><strong>Revisar:</strong> ${qualityIssues.map(issue => escapeHtml(qualidade.label(issue))).join(" · ")}</p>` : ""}
          ${networkInScope ? `
            <section class="network-summary" aria-labelledby="network-summary-title">
              <div>
                <p class="eyebrow">Citações locais diretas · ${escapeHtml(networkScope)}</p>
                <h3 id="network-summary-title">Relações bibliográficas</h3>
                ${networkBibliography ? `<p>${escapeHtml(networkBibliography)}</p>` : ""}
                <p>${network.cited} ${network.cited === 1 ? "obra da base citada" : "obras da base citadas"} · ${network.citedBy} ${network.citedBy === 1 ? "obra da base cita" : "obras da base citam"} esta fonte</p>
              </div>
              ${network.total ? `<button class="button" type="button" data-open-network="${escapeHtml(record.id)}">Explorar citações</button>` : `<span class="network-summary__empty">Nenhuma conexão local confirmada</span>`}
            </section>` : ""}
          ${affinity.available ? `
            <section class="network-summary network-summary--affinity" aria-labelledby="affinity-summary-title">
              <div>
                <p class="eyebrow">Referências compartilhadas</p>
                <h3 id="affinity-summary-title">Mapa de afinidade</h3>
                <p>${escapeHtml(affinityDescription)}</p>
              </div>
              ${affinity.traceable && affinity.related ? `<button class="button" type="button" data-open-affinity="${escapeHtml(record.id)}">Explorar afinidades</button>` : `<span class="network-summary__empty">${affinity.traceable ? "Sem sobreposição suficiente" : "Afinidade não calculável"}</span>`}
            </section>` : ""}
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
      </article>`;
  }

  function openDetails(id) {
    const record = catalogo.find(item => item.id === id);
    if (!record) return;
    document.querySelectorAll("dialog[open]").forEach(item => {
      if (item !== el.dialog) item.close();
    });
    el.conteudo.innerHTML = detailMarkup(record);
    el.dialog.dataset.current = id;
    el.dialog.dataset.citationFormat = "bibtex";
    el.dialog.showModal();
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
    fillSelect(el.assunto, uniqueSorted(catalogo.map(item => item.assunto)), "Todos os assuntos");
    fillSelect(el.tipo, uniqueSorted(catalogo.map(item => item.tipo)), "Todos os tipos");
    fillSelect(el.publicacao, uniqueSorted(catalogo.map(item => item.publicacao)), "Todas as publicações");
    fillSelect(el.ano, uniqueSorted(catalogo.map(item => item.ano)).sort((a, b) => b.localeCompare(a)), "Todos os anos");
    fillSelect(
      el.qualidade,
      [
        "bib-verificado",
        "bib-estrutural",
        "bib-pendente",
        "pdf-falha",
        "sem-capa",
        "sem-texto-pesquisavel",
        "metadados-pendentes",
        "referencias-nao-detectadas",
        "afinidade-nao-calculavel",
      ],
      "Todos os estados"
    );
    [...el.qualidade.options].forEach(option => {
      if (option.value) option.textContent = qualidade?.label(option.value) || option.value;
    });

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

    document.querySelector("#total-documentos").textContent = `${catalogo.length} documentos`;
    document.querySelector("#total-assuntos").textContent = `${uniqueSorted(catalogo.map(item => item.assunto)).length} assuntos`;
    document.querySelector("#atualizado-em").textContent = meta.geradoEm
      ? `Atualizado em ${new Date(meta.geradoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
      : "Dados locais";
    render(true);
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
  el.limpar.addEventListener("click", clearAll);
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
  el.fechar.addEventListener("click", () => el.dialog.close());
  el.dialog.addEventListener("click", event => {
    if (event.target === el.dialog) el.dialog.close();
  });
  el.fecharRede.addEventListener("click", () => el.redeDialog.close());
  el.redeDialog.addEventListener("click", event => {
    if (event.target === el.redeDialog) el.redeDialog.close();
  });

  document.addEventListener("click", event => {
    const open = event.target.closest("[data-open]");
    if (open) openDetails(open.dataset.open);

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
      render(true);
    }

    const subject = event.target.closest("[data-filter-subject]");
    if (subject) applyDetailFilter("assunto", subject.dataset.filterSubject);
    const subsubject = event.target.closest("[data-filter-subsubject]");
    if (subsubject) applyDetailFilter("subassunto", subsubject.dataset.filterSubsubject);

    const networkOpen = event.target.closest("[data-open-network]");
    if (networkOpen) openNetwork(networkOpen.dataset.openNetwork);

    const affinityOpen = event.target.closest("[data-open-affinity]");
    if (affinityOpen) openAffinity(affinityOpen.dataset.openAffinity);

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
    if (checkbox.checked) selecionados.add(checkbox.dataset.select);
    else selecionados.delete(checkbox.dataset.select);
    checkbox.closest(".book-card")?.classList.toggle("book-card--selected", checkbox.checked);
    updateSelectionBar();
  });

  document.addEventListener("catalogo:quality-filter", event => {
    el.qualidade.value = event.detail?.value || "";
    render(true);
    document.querySelector("#resultados").scrollIntoView({ behavior: "smooth" });
  });

  document.addEventListener("keydown", event => {
    if ((event.key === "Enter" || event.key === " ") && document.activeElement?.matches(".network-node")) {
      event.preventDefault();
      openNetwork(document.activeElement.dataset.networkNode, el.redeDialog.dataset.direction || "both");
    }
    if ((event.key === "Enter" || event.key === " ") && document.activeElement?.matches(".affinity-node")) {
      event.preventDefault();
      openAffinity(document.activeElement.dataset.affinityNode);
    }
    if (event.key === "/" && document.activeElement !== el.busca && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      el.busca.focus();
    }
  });
  window.addEventListener("popstate", initialize);

  initialize();
})();
