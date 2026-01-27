import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.js';

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

  describe('--path option', () => {
    it('should install skill to custom path', () => {
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

      // Create a custom target directory
      const customPath = join(testDir, 'custom-skills');
      mkdirSync(customPath, { recursive: true });

      const result = runCli(['add', testDir, '-y', '--path', customPath], testDir);
      expect(result.stdout).toContain('my-skill');
      expect(result.stdout).toContain('custom path');
      expect(result.stdout).toContain('Done!');
      expect(result.exitCode).toBe(0);

      // Verify the skill was installed to the custom path
      const installedSkillPath = join(customPath, 'my-skill', 'SKILL.md');
      expect(existsSync(installedSkillPath)).toBe(true);

      // Verify the content was copied correctly
      const content = readFileSync(installedSkillPath, 'utf-8');
      expect(content).toContain('name: my-skill');
      expect(content).toContain('My test skill');
    });

    it('should install multiple skills to custom path', () => {
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

      // Create a custom target directory
      const customPath = join(testDir, 'custom-skills');
      mkdirSync(customPath, { recursive: true });

      const result = runCli(['add', testDir, '-y', '--path', customPath], testDir);
      expect(result.stdout).toContain('skill-one');
      expect(result.stdout).toContain('skill-two');
      expect(result.stdout).toContain('custom path');
      expect(result.stdout).toContain('Done!');
      expect(result.exitCode).toBe(0);

      // Verify both skills were installed
      expect(existsSync(join(customPath, 'skill-one', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(customPath, 'skill-two', 'SKILL.md'))).toBe(true);
    });

    it('should install specific skill to custom path with --skill flag', () => {
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

      // Create a custom target directory
      const customPath = join(testDir, 'custom-skills');
      mkdirSync(customPath, { recursive: true });

      const result = runCli(
        ['add', testDir, '-y', '--path', customPath, '--skill', 'skill-one'],
        testDir
      );
      expect(result.stdout).toContain('skill-one');
      expect(result.stdout).toContain('Done!');
      expect(result.exitCode).toBe(0);

      // Verify only skill-one was installed
      expect(existsSync(join(customPath, 'skill-one', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(customPath, 'skill-two', 'SKILL.md'))).toBe(false);
    });

    it('should use short -p flag for custom path', () => {
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
`
      );

      // Create a custom target directory
      const customPath = join(testDir, 'custom-skills');
      mkdirSync(customPath, { recursive: true });

      const result = runCli(['add', testDir, '-y', '-p', customPath], testDir);
      expect(result.stdout).toContain('my-skill');
      expect(result.stdout).toContain('Done!');
      expect(result.exitCode).toBe(0);

      // Verify the skill was installed to the custom path
      expect(existsSync(join(customPath, 'my-skill', 'SKILL.md'))).toBe(true);
    });

    it('should create custom path directory if it does not exist', () => {
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
`
      );

      // Use a non-existent custom path
      const customPath = join(testDir, 'non-existent', 'nested', 'path');

      const result = runCli(['add', testDir, '-y', '--path', customPath], testDir);
      expect(result.stdout).toContain('my-skill');
      expect(result.stdout).toContain('Done!');
      expect(result.exitCode).toBe(0);

      // Verify the skill was installed and directory was created
      expect(existsSync(join(customPath, 'my-skill', 'SKILL.md'))).toBe(true);
    });

    it('should fail when target path overlaps with source path', () => {
      // Create a test skill at the root of testDir (so skill.path == testDir)
      writeFileSync(
        join(testDir, 'SKILL.md'),
        `---
name: my-skill
description: My test skill
---

# My Skill
`
      );

      // Try to install to a path inside the skill's source directory (would cause infinite recursion)
      // Since the skill is at testDir, installing to testDir/output would overlap
      const customPath = join(testDir, 'output');

      const result = runCli(['add', testDir, '-y', '--path', customPath], testDir);
      expect(result.stdout).toContain('overlaps with source');
      expect(result.exitCode).not.toBe(0);
    });
  });
});
