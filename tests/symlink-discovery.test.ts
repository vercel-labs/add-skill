/**
 * Test that symlinked skills are properly discovered by listInstalledSkills
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, symlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { listInstalledSkills, installSkillForAgent } from '../src/installer.ts';
import type { Skill } from '../src/types.ts';

describe('symlink skill discovery', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `skills-symlink-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should discover skills installed via symlink', async () => {
    // Create a source skill
    const sourceSkillDir = join(testDir, 'source', 'test-skill');
    await mkdir(sourceSkillDir, { recursive: true });
    const skillMdContent = `---
name: Test Skill
description: A test skill
---

# Test Skill
`;
    await writeFile(join(sourceSkillDir, 'SKILL.md'), skillMdContent);

    const skill: Skill = {
      name: 'Test Skill',
      description: 'A test skill',
      path: sourceSkillDir,
    };

    // Install the skill for cursor in symlink mode
    const result = await installSkillForAgent(skill, 'cursor', {
      cwd: testDir,
      global: false,
      mode: 'symlink',
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('symlink');

    // List installed skills and verify it's found
    const installedSkills = await listInstalledSkills({
      cwd: testDir,
      global: false,
    });

    expect(installedSkills.length).toBeGreaterThan(0);
    const testSkill = installedSkills.find((s) => s.name === 'Test Skill');
    expect(testSkill).toBeDefined();
    expect(testSkill!.agents).toContain('cursor');
  });

  it('should discover symlinked skills when scanning agent directories', async () => {
    // Create canonical skill directory
    const canonicalSkillDir = join(testDir, '.agents', 'skills', 'test-skill');
    await mkdir(canonicalSkillDir, { recursive: true });
    const skillMdContent = `---
name: Symlinked Skill
description: A symlinked skill
---

# Symlinked Skill
`;
    await writeFile(join(canonicalSkillDir, 'SKILL.md'), skillMdContent);

    // Create symlink in cursor skills directory
    const cursorSkillsDir = join(testDir, '.cursor', 'skills');
    await mkdir(cursorSkillsDir, { recursive: true });
    const symlinkPath = join(cursorSkillsDir, 'test-skill');

    // Create relative symlink
    await symlink('../../.agents/skills/test-skill', symlinkPath, 'dir');

    // List installed skills
    const installedSkills = await listInstalledSkills({
      cwd: testDir,
      global: false,
    });

    expect(installedSkills.length).toBeGreaterThan(0);
    const symlinkedSkill = installedSkills.find((s) => s.name === 'Symlinked Skill');
    expect(symlinkedSkill).toBeDefined();
    expect(symlinkedSkill!.agents).toContain('cursor');
  });

  it('should handle both regular directories and symlinks', async () => {
    // Create canonical skill 1 (will be symlinked)
    const canonicalSkill1 = join(testDir, '.agents', 'skills', 'skill-1');
    await mkdir(canonicalSkill1, { recursive: true });
    await writeFile(
      join(canonicalSkill1, 'SKILL.md'),
      '---\nname: Skill 1\ndescription: First skill\n---\n'
    );

    // Create canonical skill 2 (will be copied)
    const canonicalSkill2 = join(testDir, '.agents', 'skills', 'skill-2');
    await mkdir(canonicalSkill2, { recursive: true });
    await writeFile(
      join(canonicalSkill2, 'SKILL.md'),
      '---\nname: Skill 2\ndescription: Second skill\n---\n'
    );

    // Create symlink for skill 1 in cursor
    const cursorSkillsDir = join(testDir, '.cursor', 'skills');
    await mkdir(cursorSkillsDir, { recursive: true });
    await symlink('../../.agents/skills/skill-1', join(cursorSkillsDir, 'skill-1'), 'dir');

    // Copy skill 2 to cursor (simulate copy mode)
    const copiedSkill2 = join(cursorSkillsDir, 'skill-2');
    await mkdir(copiedSkill2, { recursive: true });
    await writeFile(
      join(copiedSkill2, 'SKILL.md'),
      '---\nname: Skill 2\ndescription: Second skill\n---\n'
    );

    // List installed skills
    const installedSkills = await listInstalledSkills({
      cwd: testDir,
      global: false,
    });

    expect(installedSkills.length).toBe(2);
    
    const skill1 = installedSkills.find((s) => s.name === 'Skill 1');
    expect(skill1).toBeDefined();
    expect(skill1!.agents).toContain('cursor');

    const skill2 = installedSkills.find((s) => s.name === 'Skill 2');
    expect(skill2).toBeDefined();
    expect(skill2!.agents).toContain('cursor');
  });

  it('should find symlinked skills with mismatched directory names (Strategy 2)', async () => {
    // Create a skill with a name that when sanitized becomes different
    const canonicalSkill = join(testDir, '.agents', 'skills', 'my-complex-skill');
    await mkdir(canonicalSkill, { recursive: true });
    await writeFile(
      join(canonicalSkill, 'SKILL.md'),
      '---\nname: My Complex Skill Name!\ndescription: Skill with special characters\n---\n'
    );

    // Create symlink in cursor with a different directory name
    const cursorSkillsDir = join(testDir, '.cursor', 'skills');
    await mkdir(cursorSkillsDir, { recursive: true });
    await symlink('../../.agents/skills/my-complex-skill', join(cursorSkillsDir, 'different-name'), 'dir');

    // List installed skills - this should trigger Strategy 2 (scanning all agent dirs)
    const installedSkills = await listInstalledSkills({
      cwd: testDir,
      global: false,
    });

    expect(installedSkills.length).toBe(1);
    const skill = installedSkills.find((s) => s.name === 'My Complex Skill Name!');
    expect(skill).toBeDefined();
    expect(skill!.agents).toContain('cursor');
  });
});
