(() => {
  "use strict";

  const catalog = Array.isArray(window.CATALOGO) ? window.CATALOGO : [];
  const rede = window.RedeCitacoes;
  const afinidade = window.MapaAfinidade;
  const textIndex = window.CATALOGO_INDICE_META || {};
  const dialog = document.querySelector("#qualidade-biblioteca");
  const content = document.querySelector("#qualidade-conteudo");

  const labels = {
    "pdf-falha": "PDF com falha de leitura",
    "sem-capa": "Sem miniatura",
    "sem-texto-pesquisavel": "Sem texto pesquisável",
    "metadados-pendentes": "Metadados pendentes",
    "referencias-nao-detectadas": "Bibliografia não detectada",
    "afinidade-nao-calculavel": "Afinidade bibliográfica indisponível",
    "bib-verificado": "Bib verificado",
    "bib-estrutural": "Bib completo não verificado",
    "bib-pendente": "Bib pendente",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function bibStatus(record) {
    const missing = record.bibIncompleto || [];
    if (missing.length || record.bibStatus === "pendente") {
      return { code: "pendente", label: "Bib pendente", detail: missing.join(", ") };
    }
    if (record.bibStatus === "verificado") {
      return {
        code: "verificado",
        label: "Bib verificado",
        detail: record.bibVerificadoPor || record.bibFonte || "fonte externa",
      };
    }
    return {
      code: "estrutural",
      label: "Completo não verificado",
      detail: record.bibFonte || "metadados locais",
    };
  }

  function issues(record) {
    const values = [];
    const network = rede?.summary(record.id);
    const affinity = afinidade?.summary(record.id);
    const pdfReadable = record.pdfStatus === "ok" && (
      !textIndex.statusPorDocumento?.[record.id] || textIndex.statusPorDocumento[record.id] === "ok"
    );
    if (record.pdfStatus !== "ok") values.push("pdf-falha");
    if (!record.capa) values.push("sem-capa");
    if (textIndex.statusPorDocumento?.[record.id] && textIndex.statusPorDocumento[record.id] !== "ok") {
      values.push("sem-texto-pesquisavel");
    }
    if ((record.bibIncompleto || []).length) values.push("metadados-pendentes");
    if (pdfReadable && network?.bibliographyState === "not_found") values.push("referencias-nao-detectadas");
    if (pdfReadable && affinity?.available && !affinity.traceable) values.push("afinidade-nao-calculavel");
    values.push(`bib-${bibStatus(record).code}`);
    return values;
  }

  function matches(record, code) {
    return !code || issues(record).includes(code);
  }

  function count(code) {
    return catalog.filter(record => matches(record, code)).length;
  }

  function render() {
    const verified = count("bib-verificado");
    const structural = count("bib-estrutural");
    const pending = count("bib-pendente");
    const issueCards = [
      ["pdf-falha", "Arquivos que o extrator não conseguiu ler."],
      ["sem-capa", "Documentos sem primeira página renderizada."],
      ["sem-texto-pesquisavel", "PDFs digitalizados, protegidos ou indisponíveis para a busca integral."],
      ["metadados-pendentes", "Registros sem campos bibliográficos essenciais."],
      ["referencias-nao-detectadas", "PDFs legíveis sem seção bibliográfica formal reconhecida."],
      ["afinidade-nao-calculavel", "PDFs legíveis com menos de duas referências extraíveis."],
    ];
    content.innerHTML = `
      <header class="quality-header">
        <p class="eyebrow">Auditoria local</p>
        <h2>Qualidade e revisão</h2>
        <p>Use os indicadores como uma fila de trabalho. Cada número abre o respectivo recorte no catálogo.</p>
      </header>
      <section class="quality-bib" aria-label="Estado dos metadados bibliográficos">
        <button type="button" data-quality-filter="bib-verificado"><strong>${verified}</strong><span>Bib verificado</span><small>Conferido por serviço ou fonte externa indicada</small></button>
        <button type="button" data-quality-filter="bib-estrutural"><strong>${structural}</strong><span>Completo não verificado</span><small>Estrutura válida, ainda baseada na bibliografia local</small></button>
        <button type="button" data-quality-filter="bib-pendente"><strong>${pending}</strong><span>Bib pendente</span><small>Falta pelo menos um campo essencial</small></button>
      </section>
      <section class="quality-grid" aria-label="Pendências técnicas">
        ${issueCards.map(([code, description]) => `
          <button type="button" class="quality-card" data-quality-filter="${code}">
            <strong>${count(code)}</strong>
            <span>${escapeHtml(labels[code])}</span>
            <small>${escapeHtml(description)}</small>
          </button>`).join("")}
      </section>
      <p class="quality-note"><strong>Regra:</strong> falhas de leitura aparecem apenas na fila de PDF. “Não detectado” continua sendo um estado do extrator, não uma afirmação sobre o conteúdo da obra.</p>`;
  }

  function open() {
    render();
    document.querySelectorAll("dialog[open]").forEach(item => {
      if (item !== dialog) item.close();
    });
    if (!dialog.open) dialog.showModal();
  }

  document.querySelector("#abrir-qualidade")?.addEventListener("click", open);
  document.querySelector("#fechar-qualidade")?.addEventListener("click", () => dialog.close());
  dialog?.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
    const filter = event.target.closest("[data-quality-filter]");
    if (!filter) return;
    dialog.close();
    document.dispatchEvent(new CustomEvent("catalogo:quality-filter", {
      detail: { value: filter.dataset.qualityFilter },
    }));
  });

  window.QualidadeBiblioteca = { bibStatus, issues, matches, label: code => labels[code] || code, open };
})();
