import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, symlink } from 'fs/promises';
import { join, relative, dirname } from 'path';
import { tmpdir, platform } from 'os';
import { listInstalledSkills, installSkillForAgent } from '../src/installer.ts';
import type { Skill } from '../src/types.ts';

describe('listInstalledSkills', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `add-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // Helper to create a skill directory with SKILL.md
  async function createSkillDir(
    basePath: string,
    skillName: string,
    skillData: { name: string; description: string }
  ): Promise<string> {
    const skillDir = join(basePath, '.agents', 'skills', skillName);
    await mkdir(skillDir, { recursive: true });
    const skillMdContent = `---
name: ${skillData.name}
description: ${skillData.description}
---

# ${skillData.name}

${skillData.description}
`;
    await writeFile(join(skillDir, 'SKILL.md'), skillMdContent);
    return skillDir;
  }

  it('should return empty array for empty directory', async () => {
    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toEqual([]);
  });

  it('should find single skill in project directory', async () => {
    await createSkillDir(testDir, 'test-skill', {
      name: 'test-skill',
      description: 'A test skill',
    });

    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('test-skill');
    expect(skills[0]!.description).toBe('A test skill');
    expect(skills[0]!.scope).toBe('project');
  });

  it('should find multiple skills', async () => {
    await createSkillDir(testDir, 'skill-1', {
      name: 'skill-1',
      description: 'First skill',
    });
    await createSkillDir(testDir, 'skill-2', {
      name: 'skill-2',
      description: 'Second skill',
    });

    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toHaveLength(2);
    const skillNames = skills.map((s) => s.name).sort();
    expect(skillNames).toEqual(['skill-1', 'skill-2']);
  });

  it('should ignore directories without SKILL.md', async () => {
    await createSkillDir(testDir, 'valid-skill', {
      name: 'valid-skill',
      description: 'Valid skill',
    });

    // Create a directory without SKILL.md
    const invalidDir = join(testDir, '.agents', 'skills', 'invalid-skill');
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, 'other-file.txt'), 'content');

    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('valid-skill');
  });

  it('should handle invalid SKILL.md gracefully', async () => {
    await createSkillDir(testDir, 'valid-skill', {
      name: 'valid-skill',
      description: 'Valid skill',
    });

    // Create a directory with invalid SKILL.md (missing name/description)
    const invalidDir = join(testDir, '.agents', 'skills', 'invalid-skill');
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, 'SKILL.md'), '# Invalid\nNo frontmatter');

    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('valid-skill');
  });

  it('should filter by scope - project only', async () => {
    await createSkillDir(testDir, 'project-skill', {
      name: 'project-skill',
      description: 'Project skill',
    });

    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.scope).toBe('project');
  });

  it('should handle global scope option', async () => {
    // Test with global: true - verifies the function doesn't crash
    // Note: This checks ~/.agents/skills, results depend on system state
    const skills = await listInstalledSkills({
      global: true,
      cwd: testDir,
    });
    expect(Array.isArray(skills)).toBe(true);
  });

  it('should apply agent filter', async () => {
    await createSkillDir(testDir, 'test-skill', {
      name: 'test-skill',
      description: 'Test skill',
    });

    // Filter by a specific agent (skill should still be returned)
    const skills = await listInstalledSkills({
      global: false,
      cwd: testDir,
      agentFilter: ['cursor'] as any,
    });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('test-skill');
  });

  it('should list skills installed with symlink-passthrough mode', async () => {
    const sourceDir = join(testDir, 'source-skill');
    await mkdir(sourceDir, { recursive: true });
    const skillContent = `---
name: passthrough-skill
description: Skill installed via symlink-passthrough
---

# Passthrough Skill

This skill was installed using symlink-passthrough mode.
`;
    await writeFile(join(sourceDir, 'SKILL.md'), skillContent);

    const skill: Skill = {
      name: 'passthrough-skill',
      description: 'Skill installed via symlink-passthrough',
      path: sourceDir,
    };

    const result = await installSkillForAgent(skill, 'cursor', {
      cwd: testDir,
      mode: 'symlink-passthrough',
      sourceType: 'local',
      global: false,
    });

    expect(result.success).toBe(true);
    expect(result.canonicalPath).toBeDefined();

    // Verify the canonical path exists
    const canonicalPath = join(testDir, '.agents/skills/passthrough-skill');
    const { lstat } = await import('fs/promises');
    const canonicalStats = await lstat(canonicalPath);

    // Canonical location should be a symlink pointing to source
    expect(canonicalStats.isSymbolicLink()).toBe(true);

    const skills = await listInstalledSkills({ global: false, cwd: testDir });

    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('passthrough-skill');
    expect(skills[0]!.description).toBe('Skill installed via symlink-passthrough');
    expect(skills[0]!.scope).toBe('project');
    expect(skills[0]!.canonicalPath).toBe(canonicalPath);

    expect(skills[0]!.agents).toContain('cursor');
  });

  it('should list skills with symlink chain (source → canonical → agent)', async () => {
    const sourceDir = join(testDir, 'local-source');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, 'SKILL.md'),
      '---\nname: chain-skill\ndescription: Skill with symlink chain\n---\n'
    );

    const canonicalPath = join(testDir, '.agents/skills/chain-skill');
    await mkdir(dirname(canonicalPath), { recursive: true });

    const relativePath = relative(dirname(canonicalPath), sourceDir);
    const symlinkType = platform() === 'win32' ? 'junction' : undefined;
    await symlink(relativePath, canonicalPath, symlinkType);

    const agentPath = join(testDir, '.cursor/skills/chain-skill');
    await mkdir(dirname(agentPath), { recursive: true });
    const relativeCanonical = relative(dirname(agentPath), canonicalPath);
    await symlink(relativeCanonical, agentPath, symlinkType);

    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('chain-skill');
    expect(skills[0]!.description).toBe('Skill with symlink chain');
    expect(skills[0]!.agents).toContain('cursor');
  });
});
