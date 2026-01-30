import { describe, it, expect } from 'vitest';
import { parseSource } from '../src/source-parser.ts';

describe('parseSource with branch parameter', () => {
  it('should parse branch with slashes when explicitBranch is provided (shorthand)', () => {
    const result = parseSource('owner/repo', 'feature/some-skill');
    expect(result).toEqual({
      type: 'github',
      url: 'https://github.com/owner/repo.git',
      ref: 'feature/some-skill',
    });
  });

  it('should parse branch with slashes when explicitBranch is provided (full URL with tree)', () => {
    const result = parseSource('https://github.com/owner/repo/tree/feature', 'feature/some-skill');
    expect(result).toEqual({
      type: 'github',
      url: 'https://github.com/owner/repo.git',
      ref: 'feature/some-skill',
    });
  });

  it('should parse branch with slashes when explicitBranch is provided (URL with tree and path)', () => {
    const result = parseSource(
      'https://github.com/owner/repo/tree/feature/some-skill',
      'feature/some-skill'
    );
    expect(result).toEqual({
      type: 'github',
      url: 'https://github.com/owner/repo.git',
      ref: 'feature/some-skill',
    });
  });

  it('should treat path as subpath when no explicitBranch is provided', () => {
    const result = parseSource('https://github.com/owner/repo/tree/main/path/to/skill');
    expect(result).toEqual({
      type: 'github',
      url: 'https://github.com/owner/repo.git',
      ref: 'main',
      subpath: 'path/to/skill',
    });
  });

  it('should override URL branch with explicitBranch when both are present', () => {
    const result = parseSource('https://github.com/owner/repo/tree/main', 'feature/some-skill');
    expect(result).toEqual({
      type: 'github',
      url: 'https://github.com/owner/repo.git',
      ref: 'feature/some-skill',
    });
  });

  it('should work with complex branch names', () => {
    const result = parseSource('owner/repo', 'feature/my-feature/sub-task');
    expect(result).toEqual({
      type: 'github',
      url: 'https://github.com/owner/repo.git',
      ref: 'feature/my-feature/sub-task',
    });
  });

  it('should not affect normal branch parsing without explicitBranch', () => {
    const result = parseSource('https://github.com/owner/repo/tree/main');
    expect(result).toEqual({
      type: 'github',
      url: 'https://github.com/owner/repo.git',
      ref: 'main',
    });
  });

  it('should work with shorthand owner/repo/path when no explicitBranch', () => {
    const result = parseSource('owner/repo/path/to/skill');
    expect(result).toEqual({
      type: 'github',
      url: 'https://github.com/owner/repo.git',
      subpath: 'path/to/skill',
    });
  });

  it('should incorrectly parse branch with slashes as ref+subpath when explicitBranch is NOT provided (bad case)', () => {
    // This demonstrates the problem: when branch name has slashes like "feature/some-skill"
    // and you don't provide explicitBranch, it gets incorrectly parsed as ref + subpath
    const result = parseSource('https://github.com/owner/repo/tree/feature/some-skill');
    expect(result).toEqual({
      type: 'github',
      url: 'https://github.com/owner/repo.git',
      ref: 'feature', // ❌ Wrong: only first part is treated as branch
      subpath: 'some-skill', // ❌ Wrong: rest is treated as path
    });
    // This is why you need to use --branch flag for branches with slashes
  });
});
