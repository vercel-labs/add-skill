import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { listInstalledSkills } from '../src/installer.ts';

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
});
