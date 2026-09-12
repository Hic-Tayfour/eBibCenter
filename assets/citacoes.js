(() => {
  "use strict";

  function cleanValue(value) {
    let text = String(value || "")
      .replace(/\\([&%#_])/g, "$1")
      .replace(/--/g, "–")
      .trim();
    let previous;
    do {
      previous = text;
      text = text.replace(/\{([^{}]*)\}/g, "$1");
    } while (text !== previous);
    return text.trim();
  }

  function parseBibtex(value) {
    const text = String(value || "");
    const header = text.match(/^\s*@([A-Za-z]+)\s*\{\s*([^,]+),/);
    const parsed = {
      type: header ? header[1].toLocaleLowerCase("pt-BR") : "misc",
      key: header ? header[2].trim() : "",
      fields: {},
    };
    if (!header) return parsed;

    let index = header[0].length;
    while (index < text.length) {
      const rest = text.slice(index);
      const assignment = rest.match(/^\s*,?\s*([A-Za-z][A-Za-z0-9_-]*)\s*=\s*/);
      if (!assignment) break;
      const name = assignment[1].toLocaleLowerCase("pt-BR");
      index += assignment[0].length;
      const opening = text[index];
      let raw = "";

      if (opening === "{") {
        let depth = 1;
        const start = ++index;
        while (index < text.length && depth) {
          if (text[index] === "{" && text[index - 1] !== "\\") depth += 1;
          if (text[index] === "}" && text[index - 1] !== "\\") depth -= 1;
          index += 1;
        }
        raw = text.slice(start, index - 1);
      } else if (opening === '"') {
        const start = ++index;
        while (index < text.length) {
          if (text[index] === '"' && text[index - 1] !== "\\") break;
          index += 1;
        }
        raw = text.slice(start, index);
        index += 1;
      } else {
        const start = index;
        while (index < text.length && text[index] !== "," && text[index] !== "}") index += 1;
        raw = text.slice(start, index);
      }
      parsed.fields[name] = cleanValue(raw);
    }
    return parsed;
  }

  function isOrganization(name) {
    return /\b(university|universidade|institute|instituto|foundation|fundação|bank|banco|economist|openai|deepseek|team|committee|comitê|commission|comissão|organization|organização|association|society|ministry|governo|government|laboratory|laboratório|world|oecd)\b/i.test(name);
  }

  function personParts(name) {
    const clean = String(name || "").trim();
    if (!clean) return { family: "", given: "" };
    if (clean.includes(",")) {
      const [family, ...given] = clean.split(",");
      return { family: family.trim(), given: given.join(",").trim() };
    }
    const parts = clean.split(/\s+/);
    if (parts.length === 1) return { family: clean, given: "" };
    let familyStart = parts.length - 1;
    const particles = new Set(["da", "das", "de", "do", "dos", "van", "von"]);
    while (familyStart > 0 && particles.has(parts[familyStart - 1].toLocaleLowerCase("pt-BR"))) {
      familyStart -= 1;
    }
    return {
      family: parts.slice(familyStart).join(" "),
      given: parts.slice(0, familyStart).join(" "),
    };
  }

  function apaAuthor(name) {
    if (isOrganization(name)) return name;
    const { family, given } = personParts(name);
    const initials = given
      .split(/\s+/)
      .filter(Boolean)
      .map(part => part.split("-").map(item => `${item[0] || ""}.`).join("-"))
      .join(" ");
    return initials ? `${family}, ${initials}` : family;
  }

  function abntAuthor(name) {
    if (isOrganization(name)) return name.toLocaleUpperCase("pt-BR");
    const { family, given } = personParts(name);
    return `${family.toLocaleUpperCase("pt-BR")}${given ? `, ${given}` : ""}`;
  }

  function joinApa(names) {
    const values = names.map(apaAuthor).filter(Boolean);
    if (values.length < 2) return values[0] || "Autoria não identificada";
    if (values.length === 2) return `${values[0]} & ${values[1]}`;
    return `${values.slice(0, -1).join(", ")}, & ${values.at(-1)}`;
  }

  function linkFor(fields) {
    if (fields.doi) return `https://doi.org/${fields.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")}`;
    return fields.url || "";
  }

  function finish(value) {
    const text = String(value || "").trim();
    return text ? `${text.replace(/[.\s]+$/, "")}.` : "";
  }

  function apaEdition(value) {
    const edition = String(value || "").trim();
    const number = Number.parseInt(edition, 10);
    if (!Number.isInteger(number) || !/^\d+$/.test(edition)) return `${edition} ed.`;
    const mod100 = number % 100;
    const suffix = mod100 >= 11 && mod100 <= 13
      ? "th"
      : ({ 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th");
    return `${number}${suffix} ed.`;
  }

  function formatApa(record) {
    const { type, fields } = parseBibtex(record.bibtex);
    const authors = joinApa(record.autores || []);
    const year = fields.year || "n.d.";
    const title = record.titulo || fields.title || "Sem título";
    const link = linkFor(fields);
    const parts = [`${authors} (${year}).`, finish(title)];

    if (type === "article") {
      let publication = fields.journal || "";
      if (fields.volume) publication += `${publication ? ", " : ""}${fields.volume}`;
      if (fields.number) publication += `(${fields.number})`;
      if (fields.pages) publication += `${publication ? ", " : ""}${fields.pages}`;
      if (publication) parts.push(finish(publication));
    } else if (["inproceedings", "incollection", "proceedings"].includes(type)) {
      const book = fields.booktitle || fields.series || "";
      if (book) parts.push(finish(`In ${book}${fields.pages ? ` (pp. ${fields.pages})` : ""}`));
      if (fields.publisher) parts.push(finish(fields.publisher));
    } else if (type === "book") {
      if (fields.edition) parts.push(`(${apaEdition(fields.edition)}).`);
      if (fields.publisher) parts.push(finish(fields.publisher));
    } else {
      const source = fields.organization || fields.howpublished || fields.publisher || fields.institution || "";
      if (source) parts.push(finish(source));
    }
    if (link) parts.push(link);
    return parts.filter(Boolean).join(" ");
  }

  function formatAbnt(record) {
    const { type, fields } = parseBibtex(record.bibtex);
    const authors = (record.autores || []).map(abntAuthor).filter(Boolean).join("; ") || "AUTORIA NÃO IDENTIFICADA";
    const year = fields.year || "s.d.";
    const title = record.titulo || fields.title || "Sem título";
    const link = linkFor(fields);
    const parts = [finish(authors), finish(title)];

    if (type === "article") {
      const publication = [
        fields.journal,
        fields.volume ? `v. ${fields.volume}` : "",
        fields.number ? `n. ${fields.number}` : "",
        fields.pages ? `p. ${fields.pages}` : "",
        year,
      ].filter(Boolean).join(", ");
      parts.push(finish(publication));
    } else if (["inproceedings", "incollection", "proceedings"].includes(type)) {
      const book = fields.booktitle || fields.series || "";
      if (book) parts.push(finish(`In: ${book}`));
      const publication = [
        fields.publisher,
        fields.pages ? `p. ${fields.pages}` : "",
        year,
      ].filter(Boolean).join(", ");
      parts.push(finish(publication));
    } else if (type === "book") {
      if (fields.edition) parts.push(finish(`${fields.edition}. ed`));
      parts.push(finish([fields.publisher, year].filter(Boolean).join(", ")));
    } else {
      const source = fields.organization || fields.howpublished || fields.publisher || fields.institution || "";
      parts.push(finish([source, year].filter(Boolean).join(", ")));
    }
    if (link) parts.push(`Disponível em: ${link}.`);
    return parts.filter(Boolean).join(" ");
  }

  function format(record, formatName) {
    if (formatName === "apa") return formatApa(record);
    if (formatName === "abnt") return formatAbnt(record);
    return String(record.bibtex || "").trim();
  }

  window.Citacoes = {
    extension(formatName) {
      return formatName === "bibtex" ? "bib" : "txt";
    },
    format,
    label(formatName) {
      return { bibtex: "BibTeX", apa: "APA", abnt: "ABNT" }[formatName] || "BibTeX";
    },
    parseBibtex,
  };
})();
