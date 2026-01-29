/**
 * Unit tests for source-parser.ts
 *
 * These tests verify the URL parsing logic - they don't make network requests
 * or clone repositories. They ensure that given a URL string, the parser
 * correctly extracts type, url, ref (branch), and subpath.
 */

import { describe, it, expect } from 'vitest';
import { parseSource, getOwnerRepo } from '../src/source-parser.ts';

describe('parseSource', () => {
  describe('GitHub URL tests', () => {
    it('GitHub URL - basic repo', () => {
      const result = parseSource('https://github.com/owner/repo');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBeUndefined();
      expect(result.subpath).toBeUndefined();
    });

    it('GitHub URL - with .git suffix', () => {
      const result = parseSource('https://github.com/owner/repo.git');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
    });

    it('GitHub URL - tree with branch only', () => {
      const result = parseSource('https://github.com/owner/repo/tree/feature-branch');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBe('feature-branch');
      expect(result.subpath).toBeUndefined();
    });

    it('GitHub URL - tree with branch and path', () => {
      const result = parseSource('https://github.com/owner/repo/tree/main/skills/my-skill');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBe('main');
      expect(result.subpath).toBe('skills/my-skill');
    });

    // Note: Branch names with slashes (e.g., feature/my-feature) are ambiguous.
    // The parser treats the first segment as branch and rest as path.
    // This matches GitHub's URL structure behavior.
    it('GitHub URL - tree with slash in path (ambiguous branch)', () => {
      const result = parseSource('https://github.com/owner/repo/tree/feature/my-feature');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBe('feature');
      expect(result.subpath).toBe('my-feature');
    });
  });

  describe('GitLab URL tests', () => {
    it('GitLab URL - basic repo', () => {
      const result = parseSource('https://gitlab.com/owner/repo');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/owner/repo.git');
      expect(result.ref).toBeUndefined();
    });

    it('GitLab URL - tree with branch only', () => {
      const result = parseSource('https://gitlab.com/owner/repo/-/tree/develop');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/owner/repo.git');
      expect(result.ref).toBe('develop');
      expect(result.subpath).toBeUndefined();
    });

    it('GitLab URL - tree with branch and path', () => {
      const result = parseSource('https://gitlab.com/owner/repo/-/tree/main/src/skills');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/owner/repo.git');
      expect(result.ref).toBe('main');
      expect(result.subpath).toBe('src/skills');
    });
  });

  describe('GitHub shorthand tests', () => {
    it('GitHub shorthand - owner/repo', () => {
      const result = parseSource('owner/repo');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBeUndefined();
      expect(result.subpath).toBeUndefined();
    });

    it('GitHub shorthand - owner/repo/path', () => {
      const result = parseSource('owner/repo/skills/my-skill');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.subpath).toBe('skills/my-skill');
    });

    it('GitHub shorthand - owner/repo@skill (skill filter syntax)', () => {
      const result = parseSource('owner/repo@my-skill');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.skillFilter).toBe('my-skill');
      expect(result.subpath).toBeUndefined();
    });

    it('GitHub shorthand - owner/repo@skill with hyphenated skill name', () => {
      const result = parseSource('vercel-labs/agent-skills@find-skills');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/vercel-labs/agent-skills.git');
      expect(result.skillFilter).toBe('find-skills');
    });
  });

  describe('Local path tests', () => {
    it('Local path - relative with ./', () => {
      const result = parseSource('./my-skills');
      expect(result.type).toBe('local');
      expect(result.localPath).toContain('my-skills');
    });

    it('Local path - relative with ../', () => {
      const result = parseSource('../other-skills');
      expect(result.type).toBe('local');
      expect(result.localPath).toContain('other-skills');
    });

    it('Local path - current directory', () => {
      const result = parseSource('.');
      expect(result.type).toBe('local');
      expect(result.localPath).toBeTruthy();
    });

    it('Local path - absolute path', () => {
      const result = parseSource('/home/user/skills');
      expect(result.type).toBe('local');
      expect(result.localPath).toBe('/home/user/skills');
    });
  });

  describe('Git URL fallback tests', () => {
    it('Git URL - SSH format', () => {
      const result = parseSource('git@github.com:owner/repo.git');
      expect(result.type).toBe('git');
      expect(result.url).toBe('git@github.com:owner/repo.git');
    });

    it('Git URL - custom host', () => {
      const result = parseSource('https://git.example.com/owner/repo.git');
      expect(result.type).toBe('git');
      expect(result.url).toBe('https://git.example.com/owner/repo.git');
    });
  });
});

describe('getOwnerRepo', () => {
  it('getOwnerRepo - GitHub URL', () => {
    const parsed = parseSource('https://github.com/owner/repo');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitHub URL with .git', () => {
    const parsed = parseSource('https://github.com/owner/repo.git');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitHub URL with tree/branch/path', () => {
    const parsed = parseSource('https://github.com/owner/repo/tree/main/skills/my-skill');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitHub shorthand', () => {
    const parsed = parseSource('owner/repo');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitHub shorthand with subpath', () => {
    const parsed = parseSource('owner/repo/skills/my-skill');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitLab URL', () => {
    const parsed = parseSource('https://gitlab.com/owner/repo');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitLab URL with tree', () => {
    const parsed = parseSource('https://gitlab.com/owner/repo/-/tree/main/skills');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - local path returns null', () => {
    const parsed = parseSource('./my-skills');
    expect(getOwnerRepo(parsed)).toBeNull();
  });

  it('getOwnerRepo - absolute local path returns null', () => {
    const parsed = parseSource('/home/user/skills');
    expect(getOwnerRepo(parsed)).toBeNull();
  });

  it('getOwnerRepo - custom git host returns null', () => {
    const parsed = parseSource('https://git.example.com/owner/repo.git');
    expect(getOwnerRepo(parsed)).toBeNull();
  });

  it('getOwnerRepo - SSH format returns null', () => {
    const parsed = parseSource('git@github.com:owner/repo.git');
    expect(getOwnerRepo(parsed)).toBeNull();
  });

  it('getOwnerRepo - private GitLab instance returns null', () => {
    // This falls through to 'git' type since it's not gitlab.com
    const parsed = parseSource('https://gitlab.company.com/team/repo');
    expect(getOwnerRepo(parsed)).toBeNull();
  });
});
