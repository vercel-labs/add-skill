import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.ts';
import { shouldInstallInternalSkills } from './skills.ts';
import { parseAddOptions } from './add.ts';

describe('add command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-add-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should show error when no source provided', () => {
    const result = runCli(['add'], testDir);
    expect(result.stdout).toContain('ERROR');
    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });

  it('should show error for non-existent local path', () => {
    const result = runCli(['add', './non-existent-path', '-y'], testDir);
    expect(result.stdout).toContain('Local path does not exist');
    expect(result.exitCode).toBe(1);
  });

  it('should list skills from local path with --list flag', () => {
    // Create a test skill
    const skillDir = join(testDir, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: test-skill
description: A test skill for testing
---

# Test Skill

This is a test skill.
`
    );

    const result = runCli(['add', testDir, '--list'], testDir);
    expect(result.stdout).toContain('test-skill');
    expect(result.stdout).toContain('A test skill for testing');
    expect(result.exitCode).toBe(0);
  });

  it('should show no skills found for empty directory', () => {
    const result = runCli(['add', testDir, '-y'], testDir);
    expect(result.stdout).toContain('No skills found');
    expect(result.stdout).toContain('No valid skills found');
    expect(result.exitCode).toBe(1);
  });

  it('should install skill from local path with -y flag', () => {
    // Create a test skill
    const skillDir = join(testDir, 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: my-skill
description: My test skill
---

# My Skill

Instructions here.
`
    );

    // Create a target directory to install to
    const targetDir = join(testDir, 'project');
    mkdirSync(targetDir, { recursive: true });

    const result = runCli(['add', testDir, '-y', '-g', '--agent', 'claude-code'], targetDir);
    expect(result.stdout).toContain('my-skill');
    expect(result.stdout).toContain('Done!');
    expect(result.exitCode).toBe(0);
  });

  it('should filter skills by name with --skill flag', () => {
    // Create multiple test skills
    const skill1Dir = join(testDir, 'skills', 'skill-one');
    const skill2Dir = join(testDir, 'skills', 'skill-two');
    mkdirSync(skill1Dir, { recursive: true });
    mkdirSync(skill2Dir, { recursive: true });

    writeFileSync(
      join(skill1Dir, 'SKILL.md'),
      `---
name: skill-one
description: First skill
---
# Skill One
`
    );

    writeFileSync(
      join(skill2Dir, 'SKILL.md'),
      `---
name: skill-two
description: Second skill
---
# Skill Two
`
    );

    const result = runCli(['add', testDir, '--list', '--skill', 'skill-one'], testDir);
    // With --list, it should show only the filtered skill info
    expect(result.stdout).toContain('skill-one');
  });

  it('should show error for invalid agent name', () => {
    // Create a test skill
    const skillDir = join(testDir, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: test-skill
description: Test
---
# Test
`
    );

    const result = runCli(['add', testDir, '-y', '--agent', 'invalid-agent'], testDir);
    expect(result.stdout).toContain('Invalid agents');
    expect(result.exitCode).toBe(1);
  });

  it('should support add command aliases (a, i, install)', () => {
    // Test that aliases work (just check they don't error unexpectedly)
    const resultA = runCli(['a'], testDir);
    const resultI = runCli(['i'], testDir);
    const resultInstall = runCli(['install'], testDir);

    // All should show the same "missing source" error
    expect(resultA.stdout).toContain('Missing required argument: source');
    expect(resultI.stdout).toContain('Missing required argument: source');
    expect(resultInstall.stdout).toContain('Missing required argument: source');
  });

  describe('internal skills', () => {
    it('should skip internal skills by default', () => {
      // Create an internal skill
      const skillDir = join(testDir, 'internal-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: internal-skill
description: An internal skill
metadata:
  internal: true
---

# Internal Skill

This is an internal skill.
`
      );

      const result = runCli(['add', testDir, '--list'], testDir);
      expect(result.stdout).not.toContain('internal-skill');
    });

    it('should show internal skills when INSTALL_INTERNAL_SKILLS=1', () => {
      // Create an internal skill
      const skillDir = join(testDir, 'internal-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: internal-skill
description: An internal skill
metadata:
  internal: true
---

# Internal Skill

This is an internal skill.
`
      );

      const result = runCli(['add', testDir, '--list'], testDir, {
        INSTALL_INTERNAL_SKILLS: '1',
      });
      expect(result.stdout).toContain('internal-skill');
      expect(result.stdout).toContain('An internal skill');
    });

    it('should show internal skills when INSTALL_INTERNAL_SKILLS=true', () => {
      // Create an internal skill
      const skillDir = join(testDir, 'internal-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: internal-skill
description: An internal skill
metadata:
  internal: true
---

# Internal Skill

This is an internal skill.
`
      );

      const result = runCli(['add', testDir, '--list'], testDir, {
        INSTALL_INTERNAL_SKILLS: 'true',
      });
      expect(result.stdout).toContain('internal-skill');
    });

    it('should show non-internal skills alongside internal when env var is set', () => {
      // Create both internal and non-internal skills
      const internalDir = join(testDir, 'skills', 'internal-skill');
      const publicDir = join(testDir, 'skills', 'public-skill');
      mkdirSync(internalDir, { recursive: true });
      mkdirSync(publicDir, { recursive: true });

      writeFileSync(
        join(internalDir, 'SKILL.md'),
        `---
name: internal-skill
description: An internal skill
metadata:
  internal: true
---
# Internal Skill
`
      );

      writeFileSync(
        join(publicDir, 'SKILL.md'),
        `---
name: public-skill
description: A public skill
---
# Public Skill
`
      );

      // Without env var - only public skill visible
      const resultWithout = runCli(['add', testDir, '--list'], testDir);
      expect(resultWithout.stdout).toContain('public-skill');
      expect(resultWithout.stdout).not.toContain('internal-skill');

      // With env var - both visible
      const resultWith = runCli(['add', testDir, '--list'], testDir, {
        INSTALL_INTERNAL_SKILLS: '1',
      });
      expect(resultWith.stdout).toContain('public-skill');
      expect(resultWith.stdout).toContain('internal-skill');
    });

    it('should not treat metadata.internal: false as internal', () => {
      const skillDir = join(testDir, 'not-internal-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: not-internal-skill
description: Explicitly not internal
metadata:
  internal: false
---
# Not Internal
`
      );

      const result = runCli(['add', testDir, '--list'], testDir);
      expect(result.stdout).toContain('not-internal-skill');
    });
  });
});

describe('shouldInstallInternalSkills', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return false when INSTALL_INTERNAL_SKILLS is not set', () => {
    delete process.env.INSTALL_INTERNAL_SKILLS;
    expect(shouldInstallInternalSkills()).toBe(false);
  });

  it('should return true when INSTALL_INTERNAL_SKILLS=1', () => {
    process.env.INSTALL_INTERNAL_SKILLS = '1';
    expect(shouldInstallInternalSkills()).toBe(true);
  });

  it('should return true when INSTALL_INTERNAL_SKILLS=true', () => {
    process.env.INSTALL_INTERNAL_SKILLS = 'true';
    expect(shouldInstallInternalSkills()).toBe(true);
  });

  it('should return false for other values', () => {
    process.env.INSTALL_INTERNAL_SKILLS = '0';
    expect(shouldInstallInternalSkills()).toBe(false);

    process.env.INSTALL_INTERNAL_SKILLS = 'false';
    expect(shouldInstallInternalSkills()).toBe(false);

    process.env.INSTALL_INTERNAL_SKILLS = 'yes';
    expect(shouldInstallInternalSkills()).toBe(false);
  });
});

describe('parseAddOptions', () => {
  it('should parse --all flag', () => {
    const result = parseAddOptions(['source', '--all']);
    expect(result.source).toEqual(['source']);
    expect(result.options.all).toBe(true);
  });

  it('should parse --skill with wildcard', () => {
    const result = parseAddOptions(['source', '--skill', '*']);
    expect(result.source).toEqual(['source']);
    expect(result.options.skill).toEqual(['*']);
  });

  it('should parse --agent with wildcard', () => {
    const result = parseAddOptions(['source', '--agent', '*']);
    expect(result.source).toEqual(['source']);
    expect(result.options.agent).toEqual(['*']);
  });

  it('should parse --skill wildcard with specific agents', () => {
    const result = parseAddOptions(['source', '--skill', '*', '--agent', 'claude-code']);
    expect(result.source).toEqual(['source']);
    expect(result.options.skill).toEqual(['*']);
    expect(result.options.agent).toEqual(['claude-code']);
  });

  it('should parse --agent wildcard with specific skills', () => {
    const result = parseAddOptions(['source', '--agent', '*', '--skill', 'my-skill']);
    expect(result.source).toEqual(['source']);
    expect(result.options.agent).toEqual(['*']);
    expect(result.options.skill).toEqual(['my-skill']);
  });

  it('should parse combined flags with wildcards', () => {
    const result = parseAddOptions(['source', '-g', '--skill', '*', '-y']);
    expect(result.source).toEqual(['source']);
    expect(result.options.global).toBe(true);
    expect(result.options.skill).toEqual(['*']);
    expect(result.options.yes).toBe(true);
  });

  it('should parse --full-depth flag', () => {
    const result = parseAddOptions(['source', '--full-depth']);
    expect(result.source).toEqual(['source']);
    expect(result.options.fullDepth).toBe(true);
  });

  it('should parse --full-depth with other flags', () => {
    const result = parseAddOptions(['source', '--full-depth', '--list', '-g']);
    expect(result.source).toEqual(['source']);
    expect(result.options.fullDepth).toBe(true);
    expect(result.options.list).toBe(true);
    expect(result.options.global).toBe(true);
  });

  it('should parse --branch flag', () => {
    const result = parseAddOptions(['source', '--branch', 'feature/some-skill']);
    expect(result.source).toEqual(['source']);
    expect(result.options.branch).toBe('feature/some-skill');
  });

  it('should parse -b flag (branch shorthand)', () => {
    const result = parseAddOptions(['source', '-b', 'develop']);
    expect(result.source).toEqual(['source']);
    expect(result.options.branch).toBe('develop');
  });

  it('should parse branch with complex names', () => {
    const result = parseAddOptions(['source', '-b', 'feature/my-feature/sub-task']);
    expect(result.source).toEqual(['source']);
    expect(result.options.branch).toBe('feature/my-feature/sub-task');
  });

  it('should parse branch with other flags', () => {
    const result = parseAddOptions(['source', '-b', 'main', '-g', '-y']);
    expect(result.source).toEqual(['source']);
    expect(result.options.branch).toBe('main');
    expect(result.options.global).toBe(true);
    expect(result.options.yes).toBe(true);
  });
});

describe('find-skills prompt with -y flag', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-yes-flag-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should skip find-skills prompt when -y flag is passed', () => {
    // Create a test skill
    const skillDir = join(testDir, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: yes-flag-test-skill
description: A test skill for -y flag testing
---

# Yes Flag Test Skill

This is a test skill for -y flag mode testing.
`
    );

    // Run with -y flag - should complete without hanging
    const result = runCli(['add', testDir, '-g', '-y', '--skill', 'yes-flag-test-skill'], testDir);

    // Should not contain the find-skills prompt
    expect(result.stdout).not.toContain('Install the find-skills skill');
    expect(result.stdout).not.toContain("One-time prompt - you won't be asked again");
    // Should complete successfully
    expect(result.exitCode).toBe(0);
  });
});
