import { describe, it, expect } from 'vitest';
import { stripAnsi, visualLength, padEnd, alignTable } from './string-utils.ts';

describe('stripAnsi', () => {
  it('should return plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('should strip basic ANSI codes', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[0m')).toBe('bold');
  });

  it('should strip 256-color codes', () => {
    expect(stripAnsi('\x1b[38;5;102mcolored\x1b[0m')).toBe('colored');
  });

  it('should strip multiple ANSI codes', () => {
    expect(stripAnsi('\x1b[1m\x1b[31mred bold\x1b[0m normal')).toBe('red bold normal');
  });

  it('should handle empty string', () => {
    expect(stripAnsi('')).toBe('');
  });
});

describe('visualLength', () => {
  it('should return length of plain text', () => {
    expect(visualLength('hello')).toBe(5);
  });

  it('should ignore ANSI codes in length', () => {
    expect(visualLength('\x1b[1mbold\x1b[0m')).toBe(4);
  });

  it('should handle mixed content', () => {
    expect(visualLength('pre \x1b[31mred\x1b[0m post')).toBe(12);
  });
});

describe('padEnd', () => {
  it('should pad plain text to width', () => {
    expect(padEnd('hi', 5)).toBe('hi   ');
  });

  it('should pad text with ANSI codes based on visual width', () => {
    const colored = '\x1b[31mhi\x1b[0m';
    const padded = padEnd(colored, 5);
    expect(padded).toBe('\x1b[31mhi\x1b[0m   ');
    expect(visualLength(padded)).toBe(5);
  });

  it('should not truncate if text exceeds width', () => {
    expect(padEnd('hello', 3)).toBe('hello');
  });

  it('should handle zero padding needed', () => {
    expect(padEnd('hello', 5)).toBe('hello');
  });
});

describe('alignTable', () => {
  it('should align two columns', () => {
    const result = alignTable([
      ['short', 'desc1'],
      ['longer text', 'desc2'],
    ]);
    expect(result).toBe('short        desc1\nlonger text  desc2');
  });

  it('should align three columns', () => {
    const result = alignTable([
      ['a', 'bb', 'ccc'],
      ['aaa', 'b', 'c'],
    ]);
    expect(result).toBe('a    bb  ccc\naaa  b   c');
  });

  it('should handle ANSI codes correctly', () => {
    const result = alignTable([
      ['\x1b[1mhi\x1b[0m', 'desc1'],
      ['hello', 'desc2'],
    ]);
    // "hi" is 2 chars, "hello" is 5 chars, so column width is 5 + 2 padding = 7
    expect(stripAnsi(result)).toBe('hi     desc1\nhello  desc2');
  });

  it('should use custom padding', () => {
    const result = alignTable(
      [
        ['a', 'b'],
        ['aa', 'bb'],
      ],
      4
    );
    expect(result).toBe('a     b\naa    bb');
  });

  it('should return empty string for empty input', () => {
    expect(alignTable([])).toBe('');
  });

  it('should handle single row', () => {
    const result = alignTable([['col1', 'col2']]);
    expect(result).toBe('col1  col2');
  });

  it('should allow overflow into empty right columns', () => {
    const result = alignTable([
      ['very long text that spans multiple columns', '', ''],
      ['short', 'medium', 'end'],
    ]);
    // Row 1 has no right content, so it doesn't affect column widths
    // Row 2 determines widths: col0=5+2=7, col1=6+2=8
    // Row 1 outputs without padding since all right cols are empty
    expect(result).toBe('very long text that spans multiple columns\n' + 'short  medium  end');
  });

  it('should allow partial overflow into adjacent empty column', () => {
    const result = alignTable([
      ['much shorter', '42', '1000'],
      ['a bit longer, but not bad', '', '2000'],
    ]);
    // col0 width: max(12, 25) + 2 = 27 (both rows have right content)
    // col1 width: max(2, 0) + 2 = 4 (only row 1 counts, row 2 col1 is empty)
    // Row 2 col0 can use col0+col1 space (31) since col1 is empty
    expect(result).toBe(
      'much shorter               42  1000\n' + 'a bit longer, but not bad      2000'
    );
  });

  it('should handle mix of overflow and normal rows', () => {
    const result = alignTable([
      ['command with no comment', ''],
      ['cmd', '# has comment'],
      ['another long command here', ''],
    ]);
    // Only row 2 has right content, so col0 width = 3 + 2 = 5
    // Rows 1 and 3 overflow (no padding)
    expect(result).toBe(
      'command with no comment\n' + 'cmd  # has comment\n' + 'another long command here'
    );
  });

  it('should handle all rows having empty right columns', () => {
    const result = alignTable([
      ['line one', ''],
      ['line two', ''],
    ]);
    // No row has right content, so no padding anywhere
    expect(result).toBe('line one\nline two');
  });
});
