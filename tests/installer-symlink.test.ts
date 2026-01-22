#!/usr/bin/env tsx

/**
 * Regression tests for symlink installs when canonical and agent paths match.
 *
 * Run with: npx tsx tests/installer-symlink.test.ts
 */

import assert from 'node:assert';
import { mkdtemp, mkdir, rm, writeFile, lstat, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkillForAgent } from '../src/installer.ts';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.error(`  ${(err as Error).message}`);
    failed++;
  }
}

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  const skillMd = `---\nname: ${name}\ndescription: test\n---\n`;
  await writeFile(join(dir, 'SKILL.md'), skillMd, 'utf-8');
  return dir;
}

async function main() {
  await test('symlink install does not create self-loop when paths match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'self-loop-skill';
    const skillDir = await makeSkillSource(root, skillName);

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'amp',
        { cwd: projectDir, mode: 'symlink', global: false },
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.symlinkFailed, undefined);

      const installedPath = join(projectDir, '.agents/skills', skillName);
      const stats = await lstat(installedPath);
      assert.strictEqual(stats.isSymbolicLink(), false);
      assert.strictEqual(stats.isDirectory(), true);

      const contents = await readFile(join(installedPath, 'SKILL.md'), 'utf-8');
      assert.ok(contents.includes(`name: ${skillName}`));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await test('install cleans pre-existing self-loop symlink in canonical dir', async () => {
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
      assert.strictEqual(preStats.isSymbolicLink(), true);

      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'amp',
        { cwd: projectDir, mode: 'symlink', global: false },
      );

      assert.strictEqual(result.success, true);

      const postStats = await lstat(canonicalDir);
      assert.strictEqual(postStats.isSymbolicLink(), false);
      assert.strictEqual(postStats.isDirectory(), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
