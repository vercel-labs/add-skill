/**
 * Regression tests for symlink installs when canonical and agent paths match.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, lstat, readFile, symlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkillForAgent } from '../src/installer.ts';

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  const skillMd = `---\nname: ${name}\ndescription: test\n---\n`;
  await writeFile(join(dir, 'SKILL.md'), skillMd, 'utf-8');
  return dir;
}

/**
 * Creates a skill source with symlinks to subdirectories (like ui-ux-pro-max skill).
 * This simulates skills that use symlinks to reference data from other locations.
 */
async function makeSkillSourceWithSymlinks(root: string, name: string): Promise<string> {
  // Create the actual data directory outside the skill
  const dataDir = join(root, 'external-data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'config.json'), '{"key": "value"}', 'utf-8');

  // Create scripts directory outside the skill
  const scriptsDir = join(root, 'external-scripts');
  await mkdir(scriptsDir, { recursive: true });
  await writeFile(join(scriptsDir, 'run.sh'), '#!/bin/bash\necho "hello"', 'utf-8');

  // Create the skill directory with SKILL.md and symlinks
  const skillDir = join(root, 'source-skill');
  await mkdir(skillDir, { recursive: true });
  const skillMd = `---\nname: ${name}\ndescription: test with symlinks\n---\n`;
  await writeFile(join(skillDir, 'SKILL.md'), skillMd, 'utf-8');

  // Create symlinks to the external directories (relative paths like real skills use)
  await symlink('../external-data', join(skillDir, 'data'));
  await symlink('../external-scripts', join(skillDir, 'scripts'));

  return skillDir;
}

describe('installer symlink regression', () => {
  it('does not create self-loop when canonical and agent paths match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'self-loop-skill';
    const skillDir = await makeSkillSource(root, skillName);

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'amp',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.symlinkFailed).toBeUndefined();

      const installedPath = join(projectDir, '.agents/skills', skillName);
      const stats = await lstat(installedPath);
      expect(stats.isSymbolicLink()).toBe(false);
      expect(stats.isDirectory()).toBe(true);

      const contents = await readFile(join(installedPath, 'SKILL.md'), 'utf-8');
      expect(contents).toContain(`name: ${skillName}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleans pre-existing self-loop symlink in canonical dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'self-loop-skill';
    const skillDir = await makeSkillSource(root, skillName);
    const canonicalDir = join(projectDir, '.agents/skills', skillName);

    try {
      await mkdir(join(projectDir, '.agents/skills'), { recursive: true });
      await symlink(skillName, canonicalDir);
      const preStats = await lstat(canonicalDir);
      expect(preStats.isSymbolicLink()).toBe(true);

      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'amp',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);

      const postStats = await lstat(canonicalDir);
      expect(postStats.isSymbolicLink()).toBe(false);
      expect(postStats.isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves and copies symlinked directories instead of creating broken symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-symlink-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'symlink-skill';
    const skillDir = await makeSkillSourceWithSymlinks(root, skillName);

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'amp',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);

      const installedPath = join(projectDir, '.agents/skills', skillName);

      // Check that data directory exists and is a real directory (not a symlink)
      const dataPath = join(installedPath, 'data');
      const dataStats = await lstat(dataPath);
      expect(dataStats.isSymbolicLink()).toBe(false);
      expect(dataStats.isDirectory()).toBe(true);

      // Check that the content was copied
      const configContent = await readFile(join(dataPath, 'config.json'), 'utf-8');
      expect(configContent).toBe('{"key": "value"}');

      // Check scripts directory
      const scriptsPath = join(installedPath, 'scripts');
      const scriptsStats = await lstat(scriptsPath);
      expect(scriptsStats.isSymbolicLink()).toBe(false);
      expect(scriptsStats.isDirectory()).toBe(true);

      const scriptContent = await readFile(join(scriptsPath, 'run.sh'), 'utf-8');
      expect(scriptContent).toContain('echo "hello"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('handles multi-agent install with symlinks without EINVAL error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-multi-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'multi-agent-symlink-skill';
    const skillDir = await makeSkillSourceWithSymlinks(root, skillName);

    try {
      // Install for first agent (amp - uses .agents/skills as canonical)
      const result1 = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'amp',
        { cwd: projectDir, mode: 'symlink', global: false }
      );
      expect(result1.success).toBe(true);

      // Install for second agent (claude-code)
      // This previously failed with EINVAL because it tried to copy
      // from canonical path that contained symlinks to temp directory
      const result2 = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'claude-code',
        { cwd: projectDir, mode: 'symlink', global: false }
      );
      expect(result2.success).toBe(true);

      // Verify canonical installation has valid data directory (not a symlink)
      const canonicalPath = join(projectDir, '.agents/skills', skillName, 'data');
      const canonicalStats = await lstat(canonicalPath);
      expect(canonicalStats.isDirectory()).toBe(true);
      expect(canonicalStats.isSymbolicLink()).toBe(false);

      // Verify data was copied correctly
      const configContent = await readFile(join(canonicalPath, 'config.json'), 'utf-8');
      expect(configContent).toBe('{"key": "value"}');

      // Claude Code skill directory should exist and be accessible
      const claudeSkillPath = join(projectDir, '.claude/skills', skillName);
      const claudeSkillStats = await lstat(claudeSkillPath);
      expect(claudeSkillStats.isSymbolicLink()).toBe(true);

      // Should be able to read through the symlink
      const claudeConfig = await readFile(join(claudeSkillPath, 'data', 'config.json'), 'utf-8');
      expect(claudeConfig).toBe('{"key": "value"}');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips broken symlinks gracefully', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-broken-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'broken-symlink-skill';
    const skillDir = join(root, 'source-skill');
    await mkdir(skillDir, { recursive: true });
    const skillMd = `---\nname: ${skillName}\ndescription: test\n---\n`;
    await writeFile(join(skillDir, 'SKILL.md'), skillMd, 'utf-8');

    // Create a broken symlink pointing to non-existent path
    await symlink('../non-existent-dir', join(skillDir, 'broken'));

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'amp',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);

      // Verify SKILL.md was installed but broken symlink was skipped
      const installedPath = join(projectDir, '.agents/skills', skillName);
      const contents = await readdir(installedPath);
      expect(contents).toContain('SKILL.md');
      expect(contents).not.toContain('broken');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
