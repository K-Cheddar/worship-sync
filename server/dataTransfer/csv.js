const FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+@-]/;

export const decodeSpreadsheetFormula = (value) => {
  const text = value == null ? "" : String(value);
  // The backslash marks only WorshipSync's reversible formula-safety prefix.
  // A doubled apostrophe preserves literal values that begin with that marker.
  if (/^''\\[\s\u0000-\u001f]*[=+@-]/.test(text)) return text.slice(1);
  if (/^'\\[\s\u0000-\u001f]*[=+@-]/.test(text)) return text.slice(2);
  return text;
};

export const protectSpreadsheetFormula = (value) => {
  const text = value == null ? "" : String(value);
  if (/^'\\[=+@-]/.test(text)) return `'${text}`;
  return FORMULA_PREFIX.test(text) ? `'\\${text}` : text;
};

export const encodeCsv = (headers, rows) => {
  const cells = [headers, ...rows].map((row) =>
    headers.map((_, index) => {
      const value = protectSpreadsheetFormula(row[index]);
      return /[",\r\n]/.test(value)
        ? `"${value.replaceAll('"', '""')}"`
        : value;
    }).join(","),
  );
  return `\uFEFF${cells.join("\r\n")}\r\n`;
};

/** RFC 4180 style parser. It accepts CRLF/LF/CR, quoted newlines, and BOM. */
export const parseCsv = (input) => {
  const text = String(input ?? "").replace(/^\uFEFF/, "");
  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let rowNumber = 1;
  const issues = [];

  const finishField = () => {
    row.push(field);
    field = "";
    afterQuote = false;
  };
  const finishRow = () => {
    finishField();
    records.push({ row, rowNumber });
    row = [];
    rowNumber += 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        field += char === "\r" ? "\n" : char;
      }
      continue;
    }
    if (afterQuote && char !== "," && char !== "\r" && char !== "\n") {
      issues.push({ row: rowNumber, code: "characters_after_quote", message: "Unexpected characters after a quoted value." });
      afterQuote = false;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === '"') {
      issues.push({ row: rowNumber, code: "quote_in_unquoted_value", message: "Quotes inside an unquoted value must be escaped by quoting the whole value." });
      field += char;
    } else if (char === ",") {
      finishField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      field += char;
    }
  }
  if (quoted) issues.push({ row: rowNumber, code: "unclosed_quote", message: "A quoted value is not closed." });
  else if (field.length || row.length || afterQuote) finishRow();
  while (records.length && records.at(-1).row.every((cell) => cell === "")) records.pop();

  const headers = (records.shift()?.row || []).map((header) => header.trim());
  const totalRows = Math.max(records.length, ...issues.filter((issue) => issue.row > 1).map((issue) => issue.row - 1), 0);
  if (!headers.length) issues.push({ row: 1, code: "missing_header", message: "Add a header row before importing data." });
  const normalizedHeaders = new Set();
  headers.forEach((header) => {
    const normalized = header.toLocaleLowerCase();
    if (!header) issues.push({ row: 1, code: "blank_header", message: "Every CSV column needs a header." });
    else if (normalizedHeaders.has(normalized)) issues.push({ row: 1, code: "duplicate_header", message: `The column "${header}" appears more than once.` });
    normalizedHeaders.add(normalized);
  });
  const rows = [];
  records.forEach(({ row: values, rowNumber: sourceRow }) => {
    if (values.length !== headers.length) {
      issues.push({ row: sourceRow, code: "column_count_mismatch", message: `Expected ${headers.length} columns but found ${values.length}.` });
      return;
    }
    rows.push({ rowNumber: sourceRow, values: Object.fromEntries(headers.map((header, index) => [header, decodeSpreadsheetFormula(values[index])])) });
  });
  issues.sort((left, right) => left.row - right.row);
  return { headers, rows, totalRows, issues };
};
