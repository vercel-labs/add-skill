/**
 * Unit tests for skill path calculation in telemetry.
 *
 * These tests verify that the relativePath calculation for skillFiles
 * correctly produces paths relative to the repo root, not the search path.
 * Tests cover both Unix and Windows path styles.
 */

import { describe, it, expect } from 'vitest';
import { sep } from 'path';

/**
 * Simulates the relativePath calculation from add.ts (cross-platform version)
 */
function calculateRelativePath(
  tempDir: string | null,
  skillPath: string,
  pathSep: string = sep
): string | null {
  if (tempDir && skillPath === tempDir) {
    // Skill is at root level of repo
    return 'SKILL.md';
  } else if (tempDir && skillPath.startsWith(tempDir + pathSep)) {
    // Compute path relative to repo root (tempDir)
    // Use forward slashes for telemetry (URL-style paths)
    return (
      skillPath
        .slice(tempDir.length + 1)
        .split(pathSep)
        .join('/') + '/SKILL.md'
    );
  } else {
    // Local path - skip telemetry
    return null;
  }
}

describe('calculateRelativePath (Unix paths)', () => {
  // Explicitly use '/' as separator for Unix-style paths
  const unixSep = '/';

  it('skill at repo root', () => {
    const tempDir = '/tmp/abc123';
    const skillPath = '/tmp/abc123';
    const result = calculateRelativePath(tempDir, skillPath, unixSep);
    expect(result).toBe('SKILL.md');
  });

  it('skill in skills/ subdirectory', () => {
    const tempDir = '/tmp/abc123';
    const skillPath = '/tmp/abc123/skills/my-skill';
    const result = calculateRelativePath(tempDir, skillPath, unixSep);
    expect(result).toBe('skills/my-skill/SKILL.md');
  });

  it('skill in .claude/skills/ directory', () => {
    const tempDir = '/tmp/abc123';
    const skillPath = '/tmp/abc123/.claude/skills/my-skill';
    const result = calculateRelativePath(tempDir, skillPath, unixSep);
    expect(result).toBe('.claude/skills/my-skill/SKILL.md');
  });

  it('skill in nested subdirectory', () => {
    const tempDir = '/tmp/abc123';
    const skillPath = '/tmp/abc123/skills/.curated/advanced-skill';
    const result = calculateRelativePath(tempDir, skillPath, unixSep);
    expect(result).toBe('skills/.curated/advanced-skill/SKILL.md');
  });

  it('local path returns null', () => {
    const tempDir = null;
    const skillPath = '/Users/me/projects/my-skill';
    const result = calculateRelativePath(tempDir, skillPath, unixSep);
    expect(result).toBeNull();
  });

  it('path not under tempDir returns null', () => {
    const tempDir = '/tmp/abc123';
    const skillPath = '/tmp/other/my-skill';
    const result = calculateRelativePath(tempDir, skillPath, unixSep);
    expect(result).toBeNull();
  });

  it('onmax/nuxt-skills: skill in skills/ts-library', () => {
    const tempDir = '/tmp/clone-xyz';
    // discoverSkills finds /tmp/clone-xyz/skills/ts-library/SKILL.md
    // skill.path = dirname(skillMdPath) = /tmp/clone-xyz/skills/ts-library
    const skillPath = '/tmp/clone-xyz/skills/ts-library';
    const result = calculateRelativePath(tempDir, skillPath, unixSep);
    expect(result).toBe('skills/ts-library/SKILL.md');
  });
});

describe('calculateRelativePath (Windows paths)', () => {
  it('skill at repo root (Windows)', () => {
    const tempDir = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123';
    const skillPath = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123';
    const result = calculateRelativePath(tempDir, skillPath, '\\');
    expect(result).toBe('SKILL.md');
  });

  it('skill in skills\\ subdirectory (Windows)', () => {
    const tempDir = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123';
    const skillPath = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123\\skills\\my-skill';
    const result = calculateRelativePath(tempDir, skillPath, '\\');
    expect(result).toBe('skills/my-skill/SKILL.md');
  });

  it('skill in .claude\\skills\\ directory (Windows)', () => {
    const tempDir = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123';
    const skillPath = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123\\.claude\\skills\\my-skill';
    const result = calculateRelativePath(tempDir, skillPath, '\\');
    expect(result).toBe('.claude/skills/my-skill/SKILL.md');
  });

  it('skill in nested subdirectory (Windows)', () => {
    const tempDir = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123';
    const skillPath =
      'C:\\Users\\test\\AppData\\Local\\Temp\\abc123\\skills\\.curated\\advanced-skill';
    const result = calculateRelativePath(tempDir, skillPath, '\\');
    expect(result).toBe('skills/.curated/advanced-skill/SKILL.md');
  });

  it('path not under tempDir returns null (Windows)', () => {
    const tempDir = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123';
    const skillPath = 'C:\\Users\\test\\AppData\\Local\\Temp\\other\\my-skill';
    const result = calculateRelativePath(tempDir, skillPath, '\\');
    expect(result).toBeNull();
  });

  it('handles similar path prefixes correctly (Windows)', () => {
    // This tests that we don't match partial directory names
    const tempDir = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc';
    const skillPath = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123\\skills\\my-skill';
    const result = calculateRelativePath(tempDir, skillPath, '\\');
    expect(result).toBeNull();
  });
});
