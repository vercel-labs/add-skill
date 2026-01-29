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

// Helper to check if a cell is empty
function isEmpty(cell: string | undefined): boolean {
  return !cell || cell.trim() === '';
}

// Align a multi-column table, padding each column based on visual width.
// Cells can overflow into adjacent empty columns to the right.
export function alignTable(rows: ReadonlyArray<readonly string[]>, minPadding: number = 2): string {
  const firstRow = rows[0];
  if (!firstRow) return '';

  const numCols = firstRow.length;

  // Calculate max width for each column (except the last).
  // Only consider rows where the cell has non-empty content to its right,
  // since cells with all-empty right siblings can overflow.
  const colWidths: number[] = [];
  for (let col = 0; col < numCols - 1; col++) {
    let maxWidth = 0;
    for (const row of rows) {
      const hasRightContent = row.slice(col + 1).some((c) => !isEmpty(c));
      if (hasRightContent) {
        maxWidth = Math.max(maxWidth, visualLength(row[col] ?? ''));
      }
    }
    colWidths.push(maxWidth > 0 ? maxWidth + minPadding : 0);
  }

  // Format each row
  return rows
    .map((row) => {
      const parts: string[] = [];

      for (let i = 0; i < row.length; i++) {
        const cell = row[i] ?? '';

        // Find the next non-empty column in this row
        let nextNonEmptyIdx = -1;
        for (let j = i + 1; j < row.length; j++) {
          if (!isEmpty(row[j])) {
            nextNonEmptyIdx = j;
            break;
          }
        }

        if (nextNonEmptyIdx === -1) {
          // All remaining columns are empty, output cell without padding
          parts.push(cell);
          break;
        } else {
          // Calculate available width (this column + any empty columns until next non-empty)
          let availableWidth = 0;
          for (let k = i; k < nextNonEmptyIdx; k++) {
            availableWidth += colWidths[k] ?? 0;
          }
          parts.push(padEnd(cell, availableWidth));
          // Skip to the next non-empty column
          i = nextNonEmptyIdx - 1;
        }
      }

      return parts.join('');
    })
    .join('\n');
}
