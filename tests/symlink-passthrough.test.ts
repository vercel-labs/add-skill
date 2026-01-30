import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  lstat,
  readFile,
  readlink,
  symlink,
} from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkillForAgent } from '../src/installer.ts';
import type { Skill } from '../src/types.ts';

// Mock the symlink function for fallback tests
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    symlink: vi.fn(actual.symlink),
  };
});

async function createTestSkill(root: string, name: string): Promise<string> {
  const skillDir = join(root, 'local-skill');
  await mkdir(skillDir, { recursive: true });
  const skillMd = `---
name: ${name}
description: Test skill for symlink passthrough
---

# ${name}

This is a test skill.
`;
  await writeFile(join(skillDir, 'SKILL.md'), skillMd, 'utf-8');
  await writeFile(join(skillDir, 'extra.md'), 'Extra content', 'utf-8');
  return skillDir;
}

async function verifySymlink(linkPath: string, expectedTarget: string): Promise<void> {
  const stats = await lstat(linkPath);
  expect(stats.isSymbolicLink()).toBe(true);

  const target = await readlink(linkPath);
  const resolvedTarget = join(dirname(linkPath), target);
  expect(resolvedTarget).toBe(expectedTarget);
}

async function verifyRealDirectory(dirPath: string): Promise<void> {
  const stats = await lstat(dirPath);
  expect(stats.isDirectory()).toBe(true);
  expect(stats.isSymbolicLink()).toBe(false);

  const skillMdPath = join(dirPath, 'SKILL.md');
  const content = await readFile(skillMdPath, 'utf-8');
  expect(content).toContain('name:');
  expect(content).toContain('description:');
}

describe('symlink-passthrough mode', () => {
  let tempRoot: string;
  let projectDir: string;
  let skillSourcePath: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'symlink-passthrough-'));
    projectDir = join(tempRoot, 'project');
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  describe('successful symlink chain creation', () => {
    it('creates symlink from local source to canonical location', async () => {
      const skillName = 'test-skill';
      skillSourcePath = await createTestSkill(tempRoot, skillName);

      const skill: Skill = {
        name: skillName,
        description: 'Test skill',
        path: skillSourcePath,
      };

      const result = await installSkillForAgent(skill, 'cursor', {
        cwd: projectDir,
        mode: 'symlink-passthrough',
        sourceType: 'local',
        global: false,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('symlink-passthrough');
      expect(result.symlinkFailed).toBeUndefined();

      const canonicalPath = join(projectDir, '.agents/skills', skillName);
      await verifySymlink(canonicalPath, skillSourcePath);
    });

    it('creates symlink from canonical location to agent directory', async () => {
      const skillName = 'test-skill';
      skillSourcePath = await createTestSkill(tempRoot, skillName);

      const skill: Skill = {
        name: skillName,
        description: 'Test skill',
        path: skillSourcePath,
      };

      const result = await installSkillForAgent(skill, 'cursor', {
        cwd: projectDir,
        mode: 'symlink-passthrough',
        sourceType: 'local',
        global: false,
      });

      expect(result.success).toBe(true);

      const canonicalPath = join(projectDir, '.agents/skills', skillName);
      const agentPath = join(projectDir, '.cursor/skills', skillName);

      await verifySymlink(agentPath, canonicalPath);
    });

    it('creates complete chain: local → canonical → agent', async () => {
      const skillName = 'test-skill';
      skillSourcePath = await createTestSkill(tempRoot, skillName);

      const skill: Skill = {
        name: skillName,
        description: 'Test skill',
        path: skillSourcePath,
      };

      const result = await installSkillForAgent(skill, 'cursor', {
        cwd: projectDir,
        mode: 'symlink-passthrough',
        sourceType: 'local',
        global: false,
      });

      expect(result.success).toBe(true);
      expect(result.path).toBe(join(projectDir, '.cursor/skills', skillName));
      expect(result.canonicalPath).toBe(join(projectDir, '.agents/skills', skillName));

      const canonicalPath = join(projectDir, '.agents/skills', skillName);
      const agentPath = join(projectDir, '.cursor/skills', skillName);

      await verifySymlink(canonicalPath, skillSourcePath);
      await verifySymlink(agentPath, canonicalPath);

      const skillMdPath = join(agentPath, 'SKILL.md');
      const content = await readFile(skillMdPath, 'utf-8');
      expect(content).toContain(skillName);
    });

    it('works with multiple agents', async () => {
      const skillName = 'multi-agent-skill';
      skillSourcePath = await createTestSkill(tempRoot, skillName);

      const skill: Skill = {
        name: skillName,
        description: 'Test skill',
        path: skillSourcePath,
      };

      const result1 = await installSkillForAgent(skill, 'cursor', {
        cwd: projectDir,
        mode: 'symlink-passthrough',
        sourceType: 'local',
        global: false,
      });

      const result2 = await installSkillForAgent(skill, 'claude-code', {
        cwd: projectDir,
        mode: 'symlink-passthrough',
        sourceType: 'local',
        global: false,
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      const canonicalPath = join(projectDir, '.agents/skills', skillName);
      const cursorPath = join(projectDir, '.cursor/skills', skillName);
      const claudePath = join(projectDir, '.claude/skills', skillName);

      await verifySymlink(canonicalPath, skillSourcePath);
      await verifySymlink(cursorPath, canonicalPath);
      await verifySymlink(claudePath, canonicalPath);
    });

    it('works with global installation', async () => {
      const skillName = 'global-skill';
      skillSourcePath = await createTestSkill(tempRoot, skillName);

      const skill: Skill = {
        name: skillName,
        description: 'Test skill',
        path: skillSourcePath,
      };

      const result = await installSkillForAgent(skill, 'cursor', {
        cwd: projectDir,
        mode: 'symlink-passthrough',
        sourceType: 'local',
        global: true,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('symlink-passthrough');

      expect(result.canonicalPath).toContain('.agents/skills');
      expect(result.path).toContain('.cursor/skills');
    });
  });

  describe('mode selection and sourceType validation', () => {
    it('only activates with sourceType="local"', async () => {
      const skillName = 'remote-skill';
      skillSourcePath = await createTestSkill(tempRoot, skillName);

      const skill: Skill = {
        name: skillName,
        description: 'Test skill',
        path: skillSourcePath,
      };

      const result = await installSkillForAgent(skill, 'cursor', {
        cwd: projectDir,
        mode: 'symlink-passthrough',
        sourceType: 'github',
        global: false,
      });

      expect(result.success).toBe(true);
      // Should fall back to regular 'symlink' mode since sourceType is not 'local'
      expect(result.mode).toBe('symlink');

      const canonicalPath = join(projectDir, '.agents/skills', skillName);
      await verifyRealDirectory(canonicalPath);

      const agentPath = join(projectDir, '.cursor/skills', skillName);
      await verifySymlink(agentPath, canonicalPath);
    });

    it('requires explicit mode="symlink-passthrough"', async () => {
      const skillName = 'default-mode-skill';
      skillSourcePath = await createTestSkill(tempRoot, skillName);

      const skill: Skill = {
        name: skillName,
        description: 'Test skill',
        path: skillSourcePath,
      };

      // Install with default mode (should be 'symlink')
      const result = await installSkillForAgent(skill, 'cursor', {
        cwd: projectDir,
        sourceType: 'local',
        global: false,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('symlink');

      // Should use regular symlink mode (copy to canonical, then symlink)
      const canonicalPath = join(projectDir, '.agents/skills', skillName);
      await verifyRealDirectory(canonicalPath);
    });

    it('does not activate for copy mode', async () => {
      const skillName = 'copy-mode-skill';
      skillSourcePath = await createTestSkill(tempRoot, skillName);

      const skill: Skill = {
        name: skillName,
        description: 'Test skill',
        path: skillSourcePath,
      };

      const result = await installSkillForAgent(skill, 'cursor', {
        cwd: projectDir,
        mode: 'copy',
        sourceType: 'local',
        global: false,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('copy');

      // Should have copied directly to agent location
      const agentPath = join(projectDir, '.cursor/skills', skillName);
      await verifyRealDirectory(agentPath);

      // Canonical location should not exist for copy mode
      const canonicalPath = join(projectDir, '.agents/skills', skillName);
      await expect(lstat(canonicalPath)).rejects.toThrow();
    });
  });

  describe('edge cases and cleanup', () => {
    it('replaces existing symlink in canonical location', async () => {
      const skillName = 'existing-symlink';
      skillSourcePath = await createTestSkill(tempRoot, skillName);

      const oldSourcePath = await createTestSkill(tempRoot, 'old-skill');

      const canonicalPath = join(projectDir, '.agents/skills', skillName);
      await mkdir(dirname(canonicalPath), { recursive: true });
      const relativePath = relative(dirname(canonicalPath), oldSourcePath);
      await writeFile(join(oldSourcePath, 'SKILL.md'), '---\nname: old\n---\n', 'utf-8');

      const skill: Skill = {
        name: skillName,
        description: 'Test skill',
        path: skillSourcePath,
      };

      const result = await installSkillForAgent(skill, 'cursor', {
        cwd: projectDir,
        mode: 'symlink-passthrough',
        sourceType: 'local',
        global: false,
      });

      expect(result.success).toBe(true);

      await verifySymlink(canonicalPath, skillSourcePath);
    });
  });

  describe('integration with agent-specific logic', () => {
    it('respects agent-specific skills directories', async () => {
      const skillName = 'amp-skill';
      skillSourcePath = await createTestSkill(tempRoot, skillName);

      const skill: Skill = {
        name: skillName,
        description: 'Test skill',
        path: skillSourcePath,
      };

      const result = await installSkillForAgent(skill, 'amp', {
        cwd: projectDir,
        mode: 'symlink-passthrough',
        sourceType: 'local',
        global: false,
      });

      expect(result.success).toBe(true);

      const agentPath = join(projectDir, '.agents/skills', skillName);
      const canonicalPath = join(projectDir, '.agents/skills', skillName);

      // Since they're the same, should just be a symlink to source skill
      await verifySymlink(canonicalPath, skillSourcePath);
    });
  });
});
