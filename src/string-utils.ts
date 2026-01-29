// Strip ANSI escape codes to get the visual display length of a string
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function visualLength(str: string): number {
  return stripAnsi(str).length;
}

// Pad a string (which may contain ANSI codes) to a target visual width
export function padEnd(str: string, width: number): string {
  const padding = Math.max(0, width - visualLength(str));
  return str + ' '.repeat(padding);
}

// Align a multi-column table, padding each column based on visual width
export function alignTable(rows: ReadonlyArray<readonly string[]>, minPadding: number = 2): string {
  const firstRow = rows[0];
  if (!firstRow) return '';

  const numCols = firstRow.length;

  // Calculate max width for each column (except the last)
  const colWidths: number[] = [];
  for (let col = 0; col < numCols - 1; col++) {
    const maxWidth = Math.max(...rows.map((row) => visualLength(row[col] ?? '')));
    colWidths.push(maxWidth + minPadding);
  }

  // Format each row, padding all columns except the last
  return rows
    .map((row) =>
      row.map((cell, i) => (i < row.length - 1 ? padEnd(cell, colWidths[i] ?? 0) : cell)).join('')
    )
    .join('\n');
}
