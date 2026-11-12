'use strict';

// src/index.ts
function parseCsv(text, options = {}) {
  const delim = options.delimiter ?? ",";
  const quote = options.quote ?? '"';
  if (delim.length !== 1) throw new Error("Delimiter must be a single character");
  const rows = [];
  const issues = [];
  let row = [];
  let field = "";
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const len = text.length;
  if (text.charCodeAt(0) === 65279) i = 1;
  let fieldStarted = false;
  const endRecord = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
    fieldStarted = false;
  };
  while (i < len) {
    const c = text[i];
    if (c === quote && field === "" && !fieldQuotedTail()) {
      const qLine = line;
      const qCol = i - lineStart + 1;
      i++;
      let closed = false;
      while (i < len) {
        const d = text[i];
        if (d === quote) {
          if (text[i + 1] === quote) {
            field += quote;
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        if (d === "\n" || d === "\r" && text[i + 1] !== "\n") {
          line++;
          lineStart = i + 1;
        }
        field += d;
        i++;
      }
      fieldStarted = true;
      if (!closed) {
        issues.push({ message: "Quoted field is never closed; the rest of the input was read into it", line: qLine, column: qCol });
        break;
      }
      if (i < len && text[i] !== delim && text[i] !== "\n" && text[i] !== "\r") {
        issues.push({
          message: "Unexpected text after a closing quote; it was appended to the field",
          line,
          column: i - lineStart + 1
        });
        while (i < len && text[i] !== delim && text[i] !== "\n" && text[i] !== "\r") field += text[i++];
      }
      continue;
    }
    if (c === delim) {
      row.push(field);
      field = "";
      fieldStarted = true;
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      endRecord();
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (c === quote) {
      issues.push({ message: "Quote character inside an unquoted field (kept as a literal)", line, column: i - lineStart + 1 });
    }
    field += c;
    fieldStarted = true;
    i++;
  }
  if (fieldStarted || field !== "" || row.length > 0) endRecord();
  return { rows, issues };
  function fieldQuotedTail() {
    if (i === 0 || i === 1 && text.charCodeAt(0) === 65279) return false;
    const prev = text[i - 1];
    return !(prev === delim || prev === "\n" || prev === "\r");
  }
}
var NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
function inferValue(s, emptyAsNull = false) {
  if (s === "") return emptyAsNull ? null : "";
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (NUMBER_RE.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && String(n) === s) return n;
  }
  return s;
}
function uniqueHeaders(raw) {
  const used = /* @__PURE__ */ new Map();
  return raw.map((h, idx) => {
    let name = h.trim() === "" ? `column_${idx + 1}` : h;
    const n = used.get(name) ?? 0;
    used.set(name, n + 1);
    if (n > 0) {
      let k = n + 1;
      while (used.has(`${name}_${k}`)) k++;
      name = `${name}_${k}`;
      used.set(name, 1);
    }
    return name;
  });
}
function csvToJson(text, o = {}) {
  const { rows, issues } = parseCsv(text, o);
  let records = o.skipEmptyLines === false ? rows : rows.filter((r) => !(r.length === 1 && r[0] === ""));
  const conv = (s) => o.inferTypes ? inferValue(s, o.emptyAsNull) : o.emptyAsNull && s === "" ? null : s;
  if (!o.header) {
    return { data: records.map((r) => r.map(conv)), headers: [], issues, rowCount: records.length };
  }
  if (records.length === 0) return { data: [], headers: [], issues, rowCount: 0 };
  const headers = uniqueHeaders(records[0]);
  records = records.slice(1);
  const data = records.map((r, idx) => {
    if (r.length !== headers.length) {
      issues.push({
        message: `Row ${idx + 2} has ${r.length} field${r.length === 1 ? "" : "s"}; the header has ${headers.length}`,
        line: idx + 2,
        column: 1
      });
    }
    const obj = {};
    headers.forEach((h, j) => {
      obj[h] = j < r.length ? conv(r[j]) : null;
    });
    for (let j = headers.length; j < r.length; j++) obj[`column_${j + 1}`] = conv(r[j]);
    return obj;
  });
  return { data, headers, issues, rowCount: data.length };
}
function quoteField(value, delimiter) {
  if (value === "") return "";
  const needs = value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r") || /^\s|\s$/.test(value);
  return needs ? `"${value.replace(/"/g, '""')}"` : value;
}
function cellText(v) {
  if (v === null || v === void 0) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function flattenObject(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) flattenObject(v, key, out);
    else out[key] = v;
  }
  return out;
}
function jsonToCsv(value, o = {}) {
  const delim = o.delimiter ?? ",";
  const eol = o.lineEnding ?? "\r\n";
  const header = o.header ?? true;
  let list;
  if (Array.isArray(value)) list = value;
  else if (value && typeof value === "object") list = [value];
  else return { ok: false, message: "Expected an array of objects, an array of arrays, or a single object." };
  const esc = (s) => o.escapeFormulas && /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  const lines = [];
  if (list.length > 0 && list.every((r) => Array.isArray(r))) {
    for (const r of list) lines.push(r.map((v) => quoteField(esc(cellText(v)), delim)).join(delim));
    return { ok: true, csv: lines.join(eol), columns: [], rows: list.length };
  }
  if (!list.every((r) => r !== null && typeof r === "object" && !Array.isArray(r))) {
    return { ok: false, message: "Every item must be an object (or every item an array)." };
  }
  const records = list.map((r) => o.flatten ? flattenObject(r) : r);
  const columns = [];
  const seen = /* @__PURE__ */ new Set();
  for (const r of records)
    for (const k of Object.keys(r))
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
  if (header) lines.push(columns.map((c) => quoteField(esc(c), delim)).join(delim));
  for (const r of records) lines.push(columns.map((c) => quoteField(esc(cellText(r[c])), delim)).join(delim));
  return { ok: true, csv: lines.join(eol), columns, rows: records.length };
}
function detectDelimiter(text) {
  const sample = text.slice(0, 1e4);
  const candidates = [",", ";", "	", "|"];
  let best = ",";
  let bestScore = 0;
  for (const d of candidates) {
    const { rows } = parseCsv(sample, { delimiter: d });
    const counts = rows.slice(0, 20).map((r) => r.length);
    if (counts.length === 0) continue;
    const first = counts[0];
    if (first < 2) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

exports.csvToJson = csvToJson;
exports.detectDelimiter = detectDelimiter;
exports.inferValue = inferValue;
exports.jsonToCsv = jsonToCsv;
exports.parseCsv = parseCsv;
exports.quoteField = quoteField;
exports.uniqueHeaders = uniqueHeaders;
