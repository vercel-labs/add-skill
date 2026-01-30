/**
 * Cross-platform path handling tests.
 *
 * These tests verify that path operations work correctly on both Unix and Windows.
 * They test the actual logic used in the codebase for path manipulation.
 */

import { describe, it, expect } from 'vitest';
import { sep } from 'path';

/**
 * Simulates the shortenPath function from add.ts (cross-platform version)
 */
function shortenPath(fullPath: string, cwd: string, home: string, pathSep: string): string {
  // Ensure we match complete path segments by checking for separator after the prefix
  if (fullPath === home || fullPath.startsWith(home + pathSep)) {
    return '~' + fullPath.slice(home.length);
  }
  if (fullPath === cwd || fullPath.startsWith(cwd + pathSep)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

/**
 * Simulates the path validation from wellknown.ts
 * Note: The actual validation uses simple `includes('..')` which will match
 * filenames like '...dots'. This is intentional - it's stricter security.
 */
function isValidSkillFile(file: string): boolean {
  if (typeof file !== 'string') return false;
  // Files must not start with / or \ or contain .. (path traversal prevention)
  if (file.startsWith('/') || file.startsWith('\\') || file.includes('..')) return false;
  return true;
}

/**
 * Simulates the SKILL.md path normalization from skill-lock.ts
 */
function normalizeSkillPath(skillPath: string): string {
  let folderPath = skillPath;

  // Handle both forward and backslash separators for cross-platform compatibility
  if (folderPath.endsWith('/SKILL.md') || folderPath.endsWith('\\SKILL.md')) {
    folderPath = folderPath.slice(0, -9);
  } else if (folderPath.endsWith('SKILL.md')) {
    folderPath = folderPath.slice(0, -8);
  }

  if (folderPath.endsWith('/') || folderPath.endsWith('\\')) {
    folderPath = folderPath.slice(0, -1);
  }

  // Convert to forward slashes for GitHub API
  return folderPath.split('\\').join('/');
}

describe('shortenPath (Unix)', () => {
  const pathSep = '/';
  const home = '/Users/test';
  const cwd = '/Users/test/projects/myproject';

  it('replaces home directory with ~', () => {
    const result = shortenPath('/Users/test/documents/file.txt', cwd, home, pathSep);
    expect(result).toBe('~/documents/file.txt');
  });

  it('prefers home over cwd when cwd is under home', () => {
    // When cwd is under home, home is checked first and matches
    // This is the expected behavior - displays as ~/projects/myproject/...
    const result = shortenPath('/Users/test/projects/myproject/src/file.ts', cwd, home, pathSep);
    expect(result).toBe('~/projects/myproject/src/file.ts');
  });

  it('replaces cwd with . when cwd is not under home', () => {
    // When cwd is outside home, cwd can match
    const outsideHome = '/var/www/myproject';
    const result = shortenPath('/var/www/myproject/src/file.ts', outsideHome, home, pathSep);
    expect(result).toBe('./src/file.ts');
  });

  it('returns path unchanged if not under home or cwd', () => {
    const result = shortenPath('/var/log/system.log', cwd, home, pathSep);
    expect(result).toBe('/var/log/system.log');
  });

  it('handles exact home directory match', () => {
    const result = shortenPath('/Users/test', cwd, home, pathSep);
    expect(result).toBe('~');
  });

  it('handles exact cwd match when cwd is under home', () => {
    // Since cwd is under home, home matches first
    const result = shortenPath('/Users/test/projects/myproject', cwd, home, pathSep);
    expect(result).toBe('~/projects/myproject');
  });

  it('handles exact cwd match when cwd is outside home', () => {
    const outsideHome = '/var/www/myproject';
    const result = shortenPath('/var/www/myproject', outsideHome, home, pathSep);
    expect(result).toBe('.');
  });

  it('does not match partial directory names (home)', () => {
    // /Users/tester should NOT match /Users/test
    const result = shortenPath('/Users/tester/file.txt', cwd, home, pathSep);
    expect(result).toBe('/Users/tester/file.txt');
  });

  it('does not match partial directory names (cwd)', () => {
    // /Users/test/projects/myproject2 should NOT match /Users/test/projects/myproject
    const result = shortenPath('/Users/test/projects/myproject2/file.txt', cwd, home, pathSep);
    // It should still match home though
    expect(result).toBe('~/projects/myproject2/file.txt');
  });
});

describe('shortenPath (Windows)', () => {
  const pathSep = '\\';
  const home = 'C:\\Users\\test';
  const cwd = 'C:\\Users\\test\\projects\\myproject';

  it('replaces home directory with ~', () => {
    const result = shortenPath('C:\\Users\\test\\documents\\file.txt', cwd, home, pathSep);
    expect(result).toBe('~\\documents\\file.txt');
  });

  it('prefers home over cwd when cwd is under home', () => {
    // When cwd is under home, home is checked first and matches
    const result = shortenPath(
      'C:\\Users\\test\\projects\\myproject\\src\\file.ts',
      cwd,
      home,
      pathSep
    );
    expect(result).toBe('~\\projects\\myproject\\src\\file.ts');
  });

  it('replaces cwd with . when cwd is not under home', () => {
    // When cwd is outside home, cwd can match
    const outsideHome = 'D:\\projects\\myproject';
    const result = shortenPath('D:\\projects\\myproject\\src\\file.ts', outsideHome, home, pathSep);
    expect(result).toBe('.\\src\\file.ts');
  });

  it('returns path unchanged if not under home or cwd', () => {
    const result = shortenPath('D:\\logs\\system.log', cwd, home, pathSep);
    expect(result).toBe('D:\\logs\\system.log');
  });

  it('handles exact home directory match', () => {
    const result = shortenPath('C:\\Users\\test', cwd, home, pathSep);
    expect(result).toBe('~');
  });

  it('handles exact cwd match when cwd is under home', () => {
    // Since cwd is under home, home matches first
    const result = shortenPath('C:\\Users\\test\\projects\\myproject', cwd, home, pathSep);
    expect(result).toBe('~\\projects\\myproject');
  });

  it('handles exact cwd match when cwd is outside home', () => {
    const outsideHome = 'D:\\projects\\myproject';
    const result = shortenPath('D:\\projects\\myproject', outsideHome, home, pathSep);
    expect(result).toBe('.');
  });

  it('does not match partial directory names (home)', () => {
    // C:\Users\tester should NOT match C:\Users\test
    const result = shortenPath('C:\\Users\\tester\\file.txt', cwd, home, pathSep);
    expect(result).toBe('C:\\Users\\tester\\file.txt');
  });
});

describe('isValidSkillFile', () => {
  it('accepts valid relative paths', () => {
    expect(isValidSkillFile('SKILL.md')).toBe(true);
    expect(isValidSkillFile('src/helper.ts')).toBe(true);
    expect(isValidSkillFile('assets/logo.png')).toBe(true);
  });

  it('rejects paths starting with forward slash', () => {
    expect(isValidSkillFile('/etc/passwd')).toBe(false);
    expect(isValidSkillFile('/SKILL.md')).toBe(false);
  });

  it('rejects paths starting with backslash', () => {
    expect(isValidSkillFile('\\Windows\\System32')).toBe(false);
    expect(isValidSkillFile('\\SKILL.md')).toBe(false);
  });

  it('rejects paths with directory traversal', () => {
    expect(isValidSkillFile('../../../etc/passwd')).toBe(false);
    expect(isValidSkillFile('foo/../../../etc/passwd')).toBe(false);
    expect(isValidSkillFile('..\\..\\Windows\\System32')).toBe(false);
  });

  it('allows dots in filenames (not traversal)', () => {
    expect(isValidSkillFile('file.name.txt')).toBe(true);
    expect(isValidSkillFile('.hidden')).toBe(true);
    // Note: '...dots' contains '..' which is rejected for security
    expect(isValidSkillFile('.config')).toBe(true);
  });

  it('rejects filenames containing .. (strict security)', () => {
    // Even innocent-looking filenames with .. are rejected for security
    expect(isValidSkillFile('...dots')).toBe(false);
    expect(isValidSkillFile('file..name')).toBe(false);
  });
});

describe('normalizeSkillPath', () => {
  it('removes /SKILL.md suffix (Unix)', () => {
    const result = normalizeSkillPath('skills/my-skill/SKILL.md');
    expect(result).toBe('skills/my-skill');
  });

  it('removes \\SKILL.md suffix (Windows)', () => {
    const result = normalizeSkillPath('skills\\my-skill\\SKILL.md');
    expect(result).toBe('skills/my-skill');
  });

  it('removes SKILL.md without path separator', () => {
    const result = normalizeSkillPath('SKILL.md');
    expect(result).toBe('');
  });

  it('removes trailing forward slash', () => {
    const result = normalizeSkillPath('skills/my-skill/');
    expect(result).toBe('skills/my-skill');
  });

  it('removes trailing backslash', () => {
    const result = normalizeSkillPath('skills\\my-skill\\');
    expect(result).toBe('skills/my-skill');
  });

  it('converts Windows paths to forward slashes', () => {
    const result = normalizeSkillPath('skills\\.curated\\advanced-skill\\SKILL.md');
    expect(result).toBe('skills/.curated/advanced-skill');
  });

  it('handles mixed separators', () => {
    const result = normalizeSkillPath('skills/category\\my-skill/SKILL.md');
    expect(result).toBe('skills/category/my-skill');
  });

  it('handles root-level skill', () => {
    const result = normalizeSkillPath('/SKILL.md');
    expect(result).toBe('');
  });

  it('handles deep nested paths (Windows)', () => {
    const result = normalizeSkillPath('a\\b\\c\\d\\e\\SKILL.md');
    expect(result).toBe('a/b/c/d/e');
  });
});

describe('platform detection', () => {
  it('sep is correct for current platform', () => {
    // This will be '/' on Unix/Mac and '\\' on Windows
    expect(['/', '\\']).toContain(sep);
  });
});
