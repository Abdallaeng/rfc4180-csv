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
interface ParseCsvOptions {
    /** Field delimiter, a single character. Default ",". */
    delimiter?: string;
    /** Character used for quoting. Default '"'. */
    quote?: string;
}
/** A recoverable problem found while parsing. `line` and `column` are 1-based. */
interface CsvIssue {
    message: string;
    line: number;
    column: number;
}
interface ParseCsvResult {
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
declare function parseCsv(text: string, options?: ParseCsvOptions): ParseCsvResult;
/** A JSON scalar produced by type inference. */
type Scalar = string | number | boolean | null;
/**
 * Conservative type inference: only values that round-trip exactly become numbers
 * (so "007", "1.50" and 20-digit IDs stay strings), "true"/"false" become booleans,
 * "null" and (optionally) empty cells become null.
 *
 * @example
 * inferValue("1.5")   // 1.5
 * inferValue("02134") // "02134"
 */
declare function inferValue(s: string, emptyAsNull?: boolean): Scalar;
interface CsvToJsonOptions extends ParseCsvOptions {
    /** Use the first record as object keys. Default false (rows are returned as arrays). */
    header?: boolean;
    /** Convert numbers, booleans and "null" with {@link inferValue}. Default false (all strings). */
    inferTypes?: boolean;
    /** Turn empty cells into null. Default false. */
    emptyAsNull?: boolean;
    /** Drop blank lines. Default true. */
    skipEmptyLines?: boolean;
}
interface CsvToJsonResult {
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
declare function uniqueHeaders(raw: string[]): string[];
/**
 * Parse CSV into JSON-ready data. Rows with a different field count than the header are reported as issues;
 * missing cells become null and extra cells are kept as `column_N`.
 *
 * @example
 * csvToJson("name,age\nAda,36", { header: true, inferTypes: true }).data // [{ name: "Ada", age: 36 }]
 */
declare function csvToJson(text: string, o?: CsvToJsonOptions): CsvToJsonResult;
interface JsonToCsvOptions {
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
declare function quoteField(value: string, delimiter: string): string;
type JsonToCsvResult = {
    ok: true;
    csv: string;
    columns: string[];
    rows: number;
} | {
    ok: false;
    message: string;
};
/**
 * Write CSV from an array of objects (columns are the union of keys in first-seen order),
 * an array of arrays, or a single object. Never throws: returns `{ ok: false, message }` for other input.
 *
 * @example
 * jsonToCsv([{ a: 1, b: "x,y" }]) // { ok: true, csv: 'a,b\r\n1,"x,y"', columns: ["a", "b"], rows: 1 }
 */
declare function jsonToCsv(value: unknown, o?: JsonToCsvOptions): JsonToCsvResult;
/**
 * Guess the delimiter (",", ";", tab or "|") by how consistently it splits the first lines, ignoring quoted text.
 * Falls back to ",".
 *
 * @example
 * detectDelimiter("a;b;c\n1;2;3") // ";"
 */
declare function detectDelimiter(text: string): string;

export { csvToJson, detectDelimiter, inferValue, jsonToCsv, parseCsv, quoteField, uniqueHeaders };
export type { CsvIssue, CsvToJsonOptions, CsvToJsonResult, JsonToCsvOptions, JsonToCsvResult, ParseCsvOptions, ParseCsvResult, Scalar };
