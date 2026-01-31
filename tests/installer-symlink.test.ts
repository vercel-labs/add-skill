/**
 * Regression tests for symlink installs when canonical and agent paths match.
 */

import { describe, it, expect } from 'vitest';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  lstat,
  readFile,
  symlink,
  readlink,
  realpath,
} from 'node:fs/promises';
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

  it('creates working symlink when agent skills dir is itself a symlink', async () => {
    // Regression test for: when ~/.claude/skills/ is a symlink to ~/.dotfiles/claude/skills/,
    // relative symlinks computed from the logical path resolve incorrectly from the physical path.
    const root = await mkdtemp(join(tmpdir(), 'add-skill-'));

    // Simulate: ~/.dotfiles/claude/skills/ (real directory)
    const realSkillsDir = join(root, 'dotfiles', 'claude', 'skills');
    await mkdir(realSkillsDir, { recursive: true });

    // Simulate: project/.claude/skills -> realSkillsDir (symlinked agent skills dir)
    const projectDir = join(root, 'project');
    const logicalSkillsDir = join(projectDir, '.claude', 'skills');
    await mkdir(join(projectDir, '.claude'), { recursive: true });
    await symlink(realSkillsDir, logicalSkillsDir);

    // Create canonical location for skill source
    const skillName = 'symlinked-dir-skill';
    const canonicalBase = join(projectDir, '.agents', 'skills');
    await mkdir(canonicalBase, { recursive: true });
    const sourceSkillDir = join(root, 'source-skill');
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(
      join(sourceSkillDir, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: test\n---\n`,
      'utf-8'
    );

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: sourceSkillDir },
        'claude-code',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.symlinkFailed).toBeUndefined();

      // The symlink should be created at the logical path
      const installedPath = join(logicalSkillsDir, skillName);
      const stats = await lstat(installedPath);
      expect(stats.isSymbolicLink()).toBe(true);

      // The symlink target should resolve correctly (be readable)
      const contents = await readFile(join(installedPath, 'SKILL.md'), 'utf-8');
      expect(contents).toContain(`name: ${skillName}`);

      // Verify it's an absolute symlink (the fix)
      const linkTarget = await readlink(installedPath);
      expect(linkTarget.startsWith('/')).toBe(true);

      // Verify the physical path also works
      const physicalPath = join(realSkillsDir, skillName);
      const physicalStats = await lstat(physicalPath);
      expect(physicalStats.isSymbolicLink()).toBe(true);

      // The symlink should resolve to the canonical location
      const resolvedPath = await realpath(installedPath);
      const expectedCanonical = await realpath(join(projectDir, '.agents', 'skills', skillName));
      expect(resolvedPath).toBe(expectedCanonical);
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
});
