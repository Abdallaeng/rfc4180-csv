/**
 * CSV parsing and writing following RFC 4180, with the common relaxations real files need:
 * any single-character delimiter, LF / CRLF / CR line endings, optional header row, UTF-8 BOM.
 *
 * RFC 4180 rules implemented:
 *  - fields containing the delimiter, a quote or a line break must be enclosed in double quotes;
 *  - a double quote inside a quoted field is escaped by doubling it ("");
 *  - line breaks inside quoted fields belong to the field;
 *  - the last record may or may not end with a line break.
 *
 * Malformed input never throws: the parser recovers and reports issues with line and column.
 */

export interface ParseCsvOptions {
  /** Field delimiter, a single character. Default ",". */
  delimiter?: string;
  /** Character used for quoting. Default '"'. */
  quote?: string;
}

/** A recoverable problem found while parsing. `line` and `column` are 1-based. */
export interface CsvIssue {
  message: string;
  line: number;
  column: number;
}

export interface ParseCsvResult {
  /** Records as arrays of raw string fields. */
  rows: string[][];
  issues: CsvIssue[];
}

/**
 * Parse CSV text into rows of string fields.
 * @throws Error only when `delimiter` is not a single character.
 *
 * @example
 * parseCsv('"aaa","b""bb","ccc"').rows // [["aaa", 'b"bb', "ccc"]]
 */
export function parseCsv(text: string, options: ParseCsvOptions = {}): ParseCsvResult {
  const delim = options.delimiter ?? ",";
  const quote = options.quote ?? '"';
  if (delim.length !== 1) throw new Error("Delimiter must be a single character");
  const rows: string[][] = [];
  const issues: CsvIssue[] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const len = text.length;
  // Skip a UTF-8 byte order mark that spreadsheet exports often add.
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  let fieldStarted = false; // distinguishes an empty last line from a record with one empty field

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
      // Quoted field.
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
        if (d === "\n" || (d === "\r" && text[i + 1] !== "\n")) {
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
      // After a closing quote only a delimiter or line break is legal.
      if (i < len && text[i] !== delim && text[i] !== "\n" && text[i] !== "\r") {
        issues.push({
          message: "Unexpected text after a closing quote; it was appended to the field",
          line,
          column: i - lineStart + 1,
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

  // A quote only opens a quoted field at the very start of a field.
  function fieldQuotedTail(): boolean {
    if (i === 0 || (i === 1 && text.charCodeAt(0) === 0xfeff)) return false;
    const prev = text[i - 1];
    return !(prev === delim || prev === "\n" || prev === "\r");
  }
}

/** A JSON scalar produced by type inference. */
export type Scalar = string | number | boolean | null;

const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Conservative type inference: only values that round-trip exactly become numbers
 * (so "007", "1.50" and 20-digit IDs stay strings), "true"/"false" become booleans,
 * "null" and (optionally) empty cells become null.
 *
 * @example
 * inferValue("1.5")   // 1.5
 * inferValue("02134") // "02134"
 */
export function inferValue(s: string, emptyAsNull = false): Scalar {
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

export interface CsvToJsonOptions extends ParseCsvOptions {
  /** Use the first record as object keys. Default false (rows are returned as arrays). */
  header?: boolean;
  /** Convert numbers, booleans and "null" with {@link inferValue}. Default false (all strings). */
  inferTypes?: boolean;
  /** Turn empty cells into null. Default false. */
  emptyAsNull?: boolean;
  /** Drop blank lines. Default true. */
  skipEmptyLines?: boolean;
}

export interface CsvToJsonResult {
  /** Objects when `header` is true, otherwise arrays. */
  data: Record<string, Scalar>[] | Scalar[][];
  /** Header names after {@link uniqueHeaders}; empty without a header. */
  headers: string[];
  issues: CsvIssue[];
  /** Number of data records (header excluded). */
  rowCount: number;
}

/**
 * Make header names unique and non-empty.
 * @example
 * uniqueHeaders(["id", "", "id", "id"]) // ["id", "column_2", "id_2", "id_3"]
 */
export function uniqueHeaders(raw: string[]): string[] {
  const used = new Map<string, number>();
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

/**
 * Parse CSV into JSON-ready data. Rows with a different field count than the header are reported as issues;
 * missing cells become null and extra cells are kept as `column_N`.
 *
 * @example
 * csvToJson("name,age\nAda,36", { header: true, inferTypes: true }).data // [{ name: "Ada", age: 36 }]
 */
export function csvToJson(text: string, o: CsvToJsonOptions = {}): CsvToJsonResult {
  const { rows, issues } = parseCsv(text, o);
  let records = o.skipEmptyLines === false ? rows : rows.filter((r) => !(r.length === 1 && r[0] === ""));
  const conv = (s: string): Scalar => (o.inferTypes ? inferValue(s, o.emptyAsNull) : o.emptyAsNull && s === "" ? null : s);
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
        column: 1,
      });
    }
    const obj: Record<string, Scalar> = {};
    headers.forEach((h, j) => {
      obj[h] = j < r.length ? conv(r[j]) : null;
    });
    for (let j = headers.length; j < r.length; j++) obj[`column_${j + 1}`] = conv(r[j]);
    return obj;
  });
  return { data, headers, issues, rowCount: data.length };
}

export interface JsonToCsvOptions {
  /** Field delimiter. Default ",". */
  delimiter?: string;
  /** Record separator. Default "\r\n" (RFC 4180). */
  lineEnding?: "\r\n" | "\n";
  /** Write a header row for arrays of objects. Default true. */
  header?: boolean;
  /** Flatten nested objects into dotted column names; otherwise they are written as JSON text. */
  flatten?: boolean;
  /**
   * Prefix cells starting with = + - @ (and tab/CR) with an apostrophe so spreadsheet apps do not
   * evaluate them as formulas (CSV injection, see OWASP).
   */
  escapeFormulas?: boolean;
}

/**
 * Quote a field if it contains the delimiter, a quote, a line break, or leading/trailing whitespace.
 * @example
 * quoteField('say "hi"', ",") // '"say ""hi"""'
 */
export function quoteField(value: string, delimiter: string): string {
  if (value === "") return "";
  const needs =
    value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r") || /^\s|\s$/.test(value);
  return needs ? `"${value.replace(/"/g, '""')}"` : value;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function flattenObject(obj: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) flattenObject(v as Record<string, unknown>, key, out);
    else out[key] = v;
  }
  return out;
}

export type JsonToCsvResult = { ok: true; csv: string; columns: string[]; rows: number } | { ok: false; message: string };

/**
 * Write CSV from an array of objects (columns are the union of keys in first-seen order),
 * an array of arrays, or a single object. Never throws: returns `{ ok: false, message }` for other input.
 *
 * @example
 * jsonToCsv([{ a: 1, b: "x,y" }]) // { ok: true, csv: 'a,b\r\n1,"x,y"', columns: ["a", "b"], rows: 1 }
 */
export function jsonToCsv(value: unknown, o: JsonToCsvOptions = {}): JsonToCsvResult {
  const delim = o.delimiter ?? ",";
  const eol = o.lineEnding ?? "\r\n";
  const header = o.header ?? true;
  let list: unknown[];
  if (Array.isArray(value)) list = value;
  else if (value && typeof value === "object") list = [value];
  else return { ok: false, message: "Expected an array of objects, an array of arrays, or a single object." };

  const esc = (s: string) => (o.escapeFormulas && /^[=+\-@\t\r]/.test(s) ? "'" + s : s);
  const lines: string[] = [];

  if (list.length > 0 && list.every((r) => Array.isArray(r))) {
    for (const r of list as unknown[][]) lines.push(r.map((v) => quoteField(esc(cellText(v)), delim)).join(delim));
    return { ok: true, csv: lines.join(eol), columns: [], rows: list.length };
  }
  if (!list.every((r) => r !== null && typeof r === "object" && !Array.isArray(r))) {
    return { ok: false, message: "Every item must be an object (or every item an array)." };
  }
  const records = (list as Record<string, unknown>[]).map((r) => (o.flatten ? flattenObject(r) : r));
  const columns: string[] = [];
  const seen = new Set<string>();
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

/**
 * Guess the delimiter (",", ";", tab or "|") by how consistently it splits the first lines, ignoring quoted text.
 * Falls back to ",".
 *
 * @example
 * detectDelimiter("a;b;c\n1;2;3") // ";"
 */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 10_000);
  const candidates = [",", ";", "\t", "|"];
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
