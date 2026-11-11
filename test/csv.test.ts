import { describe, expect, it } from "vitest";
import { csvToJson, detectDelimiter, inferValue, jsonToCsv, parseCsv, quoteField, uniqueHeaders } from "../src";

// Cases follow RFC 4180 section 2, rules 1-7.
describe("parseCsv (RFC 4180)", () => {
  it("rule 1-2: CRLF-separated records, optional final line break", () => {
    expect(parseCsv("aaa,bbb,ccc\r\nzzz,yyy,xxx\r\n").rows).toEqual([
      ["aaa", "bbb", "ccc"],
      ["zzz", "yyy", "xxx"],
    ]);
    expect(parseCsv("aaa,bbb,ccc\r\nzzz,yyy,xxx").rows).toHaveLength(2);
  });
  it("rule 5: fields may be enclosed in double quotes", () => {
    expect(parseCsv('"aaa","bbb","ccc"').rows).toEqual([["aaa", "bbb", "ccc"]]);
  });
  it("rule 6: line breaks, commas and quotes inside quoted fields", () => {
    expect(parseCsv('"aaa","b\r\nbb","c,cc"\r\nzzz,yyy,xxx').rows).toEqual([
      ["aaa", "b\r\nbb", "c,cc"],
      ["zzz", "yyy", "xxx"],
    ]);
  });
  it('rule 7: a quote inside a quoted field is escaped by doubling ("")', () => {
    expect(parseCsv('"aaa","b""bb","ccc"').rows).toEqual([["aaa", 'b"bb', "ccc"]]);
    expect(parseCsv('""""').rows).toEqual([['"']]);
  });
  it("keeps empty fields, including trailing ones", () => {
    expect(parseCsv("a,,c,\n,,").rows).toEqual([
      ["a", "", "c", ""],
      ["", "", ""],
    ]);
    expect(parseCsv('""').rows).toEqual([[""]]);
  });
  it("accepts LF and lone CR line endings", () => {
    expect(parseCsv("a,b\nc,d\re,f").rows).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });
  it("tracks line numbers across quoted line breaks", () => {
    const r = parseCsv('a,"x\ny"\nb,"unclosed');
    expect(r.issues[0]).toMatchObject({ line: 3, column: 3 });
  });
  it("reports text after a closing quote and stray quotes", () => {
    expect(parseCsv('"ab"c,d').issues).toHaveLength(1);
    const r = parseCsv('5" screen,x');
    expect(r.rows[0][0]).toBe('5" screen');
    expect(r.issues).toHaveLength(1);
  });
  it("supports custom delimiters and strips a BOM", () => {
    expect(parseCsv("﻿a;b\n1;2", { delimiter: ";" }).rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb", { delimiter: "\t" }).rows).toEqual([["a", "b"]]);
  });
  it("returns no rows for empty input", () => {
    expect(parseCsv("").rows).toEqual([]);
  });
});

describe("csvToJson", () => {
  it("uses the header row for keys", () => {
    const r = csvToJson("name,age\nAda,36\nAlan,41", { header: true });
    expect(r.data).toEqual([
      { name: "Ada", age: "36" },
      { name: "Alan", age: "41" },
    ]);
  });
  it("infers types conservatively", () => {
    const r = csvToJson("zip,n,ok,x,big\n02134,1.5,true,null,12345678901234567890", { header: true, inferTypes: true });
    expect(r.data[0]).toEqual({ zip: "02134", n: 1.5, ok: true, x: null, big: "12345678901234567890" });
    expect(inferValue("1.50")).toBe("1.50");
    expect(inferValue("-0")).toBe("-0");
    expect(inferValue("", true)).toBeNull();
  });
  it("reports ragged rows and keeps extra cells", () => {
    const r = csvToJson("a,b\n1\n1,2,3", { header: true });
    expect(r.issues).toHaveLength(2);
    expect(r.data[0]).toEqual({ a: "1", b: null });
    expect(r.data[1]).toEqual({ a: "1", b: "2", column_3: "3" });
  });
  it("de-duplicates and fills header names", () => {
    expect(uniqueHeaders(["id", "", "id", "id"])).toEqual(["id", "column_2", "id_2", "id_3"]);
  });
  it("returns arrays without a header", () => {
    expect(csvToJson("1,2\n\n3,4", { inferTypes: true }).data).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("jsonToCsv", () => {
  it("unions keys in first-seen order and quotes where needed", () => {
    const r = jsonToCsv([{ a: 1, b: "x,y" }, { b: 'say "hi"', c: "line\nbreak" }]);
    expect(r).toMatchObject({ ok: true, csv: 'a,b,c\r\n1,"x,y",\r\n,"say ""hi""","line\nbreak"' });
  });
  it("round-trips through parseCsv", () => {
    const data = [{ q: '"', n: "a\r\nb", d: ";", s: " pad " }];
    const r = jsonToCsv(data);
    expect(r.ok && csvToJson(r.csv, { header: true }).data).toEqual(data);
  });
  it("flattens nested objects or writes them as JSON", () => {
    const data = [{ id: 1, user: { name: "a", tags: ["x"] } }];
    expect(jsonToCsv(data, { flatten: true, lineEnding: "\n" })).toMatchObject({ csv: 'id,user.name,user.tags\n1,a,"[""x""]"' });
    expect(jsonToCsv(data, { lineEnding: "\n" })).toMatchObject({ csv: 'id,user\n1,"{""name"":""a"",""tags"":[""x""]}"' });
  });
  it("escapes spreadsheet formulas on request", () => {
    expect(jsonToCsv([{ f: "=1+1" }], { escapeFormulas: true, header: false })).toMatchObject({ csv: "'=1+1" });
  });
  it("writes arrays of arrays and rejects scalars", () => {
    expect(jsonToCsv([[1, null], ["a", true]], { lineEnding: "\n" })).toMatchObject({ csv: "1,\na,true" });
    expect(jsonToCsv(5).ok).toBe(false);
  });
});

describe("detectDelimiter", () => {
  it("finds semicolons and tabs", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter('"x;y",b\n1,2')).toBe(",");
  });
  it("falls back to a comma for single-column text", () => {
    expect(detectDelimiter("just one column\nand another")).toBe(",");
  });
});

describe("options and helpers", () => {
  it("rejects a multi-character delimiter", () => {
    expect(() => parseCsv("a,b", { delimiter: "::" })).toThrow(/single character/);
  });
  it("quoteField quotes only when needed", () => {
    expect(quoteField("plain", ",")).toBe("plain");
    expect(quoteField('say "hi"', ",")).toBe('"say ""hi"""');
    expect(quoteField("a;b", ";")).toBe('"a;b"');
    expect(quoteField(" pad", ",")).toBe('" pad"');
    expect(quoteField("", ",")).toBe("");
  });
  it("emptyAsNull without type inference keeps other cells as strings", () => {
    expect(csvToJson("a,b\n1,", { header: true, emptyAsNull: true }).data).toEqual([{ a: "1", b: null }]);
  });
  it("skipEmptyLines: false keeps blank records", () => {
    expect(csvToJson("1\n\n2", { skipEmptyLines: false }).data).toEqual([["1"], [""], ["2"]]);
  });
  it("a single object becomes one row", () => {
    expect(jsonToCsv({ a: 1, b: 2 })).toEqual({ ok: true, csv: "a,b\r\n1,2", columns: ["a", "b"], rows: 1 });
  });
});
