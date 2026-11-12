# rfc4180-csv

A small, dependency-free RFC 4180 CSV parser and writer for TypeScript and JavaScript, with CSV ↔ JSON helpers that do not mangle your data.

- Quoted fields, doubled quotes (`""`), delimiters and line breaks inside quotes, optional final line break.
- Real-world relaxations: any single-character delimiter, LF / CRLF / lone CR, UTF-8 BOM, delimiter detection.
- Never throws on bad CSV: it recovers and reports each problem with line and column.
- CSV → JSON with conservative type inference (`"02134"`, `"1.50"` and 20-digit IDs stay strings).
- JSON → CSV with key union, optional flattening and optional spreadsheet formula escaping.
- ESM and CommonJS builds with TypeScript declarations. About 7 KB unminified.

## Install

```sh
npm i rfc4180-csv
```

> Not published to npm yet. Until it is, install straight from GitHub (the package builds itself on install):
>
> ```sh
> npm i github:Abdallaeng/rfc4180-csv
> ```

### Use it in the browser (no install)

The built ES module is served free by jsDelivr straight from this repository:

```html
<script type="module">
  import { parseCsv } from "https://cdn.jsdelivr.net/gh/Abdallaeng/rfc4180-csv@v1.0.0/dist/index.js";
  console.log(parseCsv("a,b\n1,2").rows); // [["a", "b"], ["1", "2"]]
</script>
```

## API

Outputs below are the values asserted in the test suite.

### `parseCsv(text, { delimiter?, quote? })`

```ts
import { parseCsv } from "rfc4180-csv";

parseCsv('"aaa","b""bb","c,cc"\r\nzzz,yyy,xxx');
// { rows: [["aaa", 'b"bb', "c,cc"], ["zzz", "yyy", "xxx"]], issues: [] }

parseCsv("a,,c,\n,,").rows;                  // [["a", "", "c", ""], ["", "", ""]]
parseCsv("﻿a;b\n1;2", { delimiter: ";" }).rows; // [["a", "b"], ["1", "2"]]

parseCsv('5" screen,x');
// { rows: [['5" screen', "x"]],
//   issues: [{ message: "Quote character inside an unquoted field (kept as a literal)", line: 1, column: 2 }] }
```

Issues are reported for an unclosed quoted field, text after a closing quote, and a stray quote inside an unquoted field. Line numbers count line breaks inside quoted fields. The only thing that throws is a delimiter that is not one character.

### `csvToJson(text, options)`

```ts
import { csvToJson } from "rfc4180-csv";

csvToJson("name,age\nAda,36\nAlan,41", { header: true }).data;
// [{ name: "Ada", age: "36" }, { name: "Alan", age: "41" }]

csvToJson("zip,n,ok,x,big\n02134,1.5,true,null,12345678901234567890", { header: true, inferTypes: true }).data;
// [{ zip: "02134", n: 1.5, ok: true, x: null, big: "12345678901234567890" }]

csvToJson("a,b\n1\n1,2,3", { header: true });
// data: [{ a: "1", b: null }, { a: "1", b: "2", column_3: "3" }]
// issues: "Row 2 has 1 field; the header has 2", "Row 3 has 3 fields; the header has 2"

csvToJson("1,2\n\n3,4", { inferTypes: true }).data; // [[1, 2], [3, 4]]
```

Options: `header`, `inferTypes`, `emptyAsNull`, `skipEmptyLines` (default true), plus `delimiter` and `quote`. Blank and duplicate header names are fixed by `uniqueHeaders`: `["id", "", "id", "id"]` → `["id", "column_2", "id_2", "id_3"]`.

Type inference (`inferValue`) only converts a number when `String(Number(s)) === s`, so it round-trips exactly. `"true"` / `"false"` become booleans and `"null"` becomes `null`.

### `jsonToCsv(value, options)`

```ts
import { jsonToCsv } from "rfc4180-csv";

jsonToCsv([{ a: 1, b: "x,y" }, { b: 'say "hi"', c: "line\nbreak" }]).csv;
// 'a,b,c\r\n1,"x,y",\r\n,"say ""hi""","line\nbreak"'

jsonToCsv([{ id: 1, user: { name: "a", tags: ["x"] } }], { flatten: true, lineEnding: "\n" }).csv;
// 'id,user.name,user.tags\n1,a,"[""x""]"'

jsonToCsv([{ f: "=1+1" }], { escapeFormulas: true, header: false }).csv;
// "'=1+1"

jsonToCsv(5); // { ok: false, message: "Expected an array of objects, an array of arrays, or a single object." }
```

Accepts an array of objects (columns are the union of keys in first-seen order), an array of arrays, or a single object. Options: `delimiter`, `lineEnding` (default `"\r\n"` as RFC 4180 says), `header`, `flatten` (dotted column names, otherwise nested values are written as JSON) and `escapeFormulas` (prefixes cells starting with `= + - @`, tab or CR with `'`, against CSV injection). Output round-trips through `csvToJson`.

### Helpers

```ts
import { detectDelimiter, quoteField, inferValue } from "rfc4180-csv";

detectDelimiter("a;b;c\n1;2;3");  // ";"
detectDelimiter("a\tb\n1\t2");    // "\t"
quoteField('say "hi"', ",");      // '"say ""hi"""'
inferValue("1.50");               // "1.50"
```

## Tests

27 Vitest cases, ported from the CSV tool where this code runs in production, follow RFC 4180 section 2 rule by rule (records, quoting, embedded line breaks, doubled quotes) and add the relaxations, issue positions, type inference, ragged rows and JSON round-trips. Run them with `npm test`.

## Limitations

- Works on a whole string in memory; there is no streaming API, so it is not meant for files of hundreds of MB.
- One-character delimiter and quote; no comment lines, no escape character other than a doubled quote.
- Whitespace around fields is kept as data (RFC 4180 says spaces are part of a field).
- For ragged rows the issue `line` is the record number, not the physical line.
- Messages are in English.

## Try it online

The same parser runs the free, in-browser [CSV to JSON converter on DevUtility Kit](https://devutility-kit.pages.dev/tools/csv-to-json/).

## License

MIT © Technical Design Team
