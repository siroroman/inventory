/**
 * Parses CSV text (RFC 4180: comma separated, fields in double quotes may hold commas, line breaks
 * and doubled quotes) into rows of fields. A leading byte order mark and a final line break are
 * ignored.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.startsWith('﻿') ? text.slice(1) : text;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (input[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The rows after the header as records keyed by column name; every column in `required` must be there. */
export function csvRecords<C extends string>(text: string, required: readonly C[]): Record<C, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('CSV is empty');
  const missing = required.filter((column) => !header.includes(column));
  if (missing.length > 0) throw new Error(`CSV lacks the columns ${missing.join(', ')}`);
  return rows.map((fields, index) => {
    if (fields.length !== header.length) {
      throw new Error(`CSV record ${index + 1} has ${fields.length} fields, the header ${header.length}`);
    }
    return Object.fromEntries(header.map((column, i) => [column, fields[i]!])) as Record<C, string>;
  });
}
