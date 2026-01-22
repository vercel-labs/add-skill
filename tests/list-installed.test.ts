#!/usr/bin/env tsx

/**
 * Unit tests for listInstalledSkills function
 *
 * These tests verify that listInstalledSkills correctly scans canonical
 * skill directories and returns installed skills with proper metadata.
 *
 * Run with: npx tsx tests/list-installed.test.ts
 */

import assert from 'node:assert';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { listInstalledSkills } from '../src/installer.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
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

// Helper to create a temporary test directory
async function createTempDir(): Promise<string> {
  const tempPath = join(tmpdir(), `add-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempPath, { recursive: true });
  return tempPath;
}

// Helper to create a skill directory with SKILL.md
async function createSkillDir(basePath: string, skillName: string, skillData: { name: string; description: string }): Promise<string> {
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

// Run all tests
(async () => {
// Test: empty directory returns empty array
await test('empty directory returns empty array', async () => {
  const tempDir = await createTempDir();
  try {
    const skills = await listInstalledSkills({ global: false, cwd: tempDir });
    assert.strictEqual(skills.length, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

await test('finds single skill in project directory', async () => {
  const tempDir = await createTempDir();
  try {
    await createSkillDir(tempDir, 'test-skill', {
      name: 'test-skill',
      description: 'A test skill',
    });

    const skills = await listInstalledSkills({ global: false, cwd: tempDir });
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0]!.name, 'test-skill');
    assert.strictEqual(skills[0]!.description, 'A test skill');
    assert.strictEqual(skills[0]!.scope, 'project');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

await test('finds multiple skills', async () => {
  const tempDir = await createTempDir();
  try {
    await createSkillDir(tempDir, 'skill-1', {
      name: 'skill-1',
      description: 'First skill',
    });
    await createSkillDir(tempDir, 'skill-2', {
      name: 'skill-2',
      description: 'Second skill',
    });

    const skills = await listInstalledSkills({ global: false, cwd: tempDir });
    assert.strictEqual(skills.length, 2);
    const skillNames = skills.map(s => s.name).sort();
    assert.deepStrictEqual(skillNames, ['skill-1', 'skill-2']);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

await test('ignores directories without SKILL.md', async () => {
  const tempDir = await createTempDir();
  try {
    await createSkillDir(tempDir, 'valid-skill', {
      name: 'valid-skill',
      description: 'Valid skill',
    });
    
    // Create a directory without SKILL.md
    const invalidDir = join(tempDir, '.agents', 'skills', 'invalid-skill');
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, 'other-file.txt'), 'content');

    const skills = await listInstalledSkills({ global: false, cwd: tempDir });
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0]!.name, 'valid-skill');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

await test('handles invalid SKILL.md gracefully', async () => {
  const tempDir = await createTempDir();
  try {
    await createSkillDir(tempDir, 'valid-skill', {
      name: 'valid-skill',
      description: 'Valid skill',
    });
    
    // Create a directory with invalid SKILL.md (missing name/description)
    const invalidDir = join(tempDir, '.agents', 'skills', 'invalid-skill');
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, 'SKILL.md'), '# Invalid\nNo frontmatter');

    const skills = await listInstalledSkills({ global: false, cwd: tempDir });
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0]!.name, 'valid-skill');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

await test('scope filtering - project only', async () => {
  const tempDir = await createTempDir();
  try {
    await createSkillDir(tempDir, 'project-skill', {
      name: 'project-skill',
      description: 'Project skill',
    });

    const skills = await listInstalledSkills({ global: false, cwd: tempDir });
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0]!.scope, 'project');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

await test('scope filtering - global only', async () => {
  const tempDir = await createTempDir();
  try {
    // Create global skill directory structure
    const globalSkillsDir = join(tempDir, '.agents', 'skills');
    await mkdir(globalSkillsDir, { recursive: true });
    const skillDir = join(globalSkillsDir, 'global-skill');
    await mkdir(skillDir, { recursive: true });
    const skillMdContent = `---
name: global-skill
description: Global skill
---

# Global Skill

Global skill description
`;
    await writeFile(join(skillDir, 'SKILL.md'), skillMdContent);

    // Test with global: true and cwd pointing to tempDir as home
    // Note: This is a simplified test - in reality global uses homedir()
    const skills = await listInstalledSkills({ 
      global: true, 
      cwd: tempDir 
    });
    // This will check ~/.agents/skills, so might be empty
    // But we verify the function doesn't crash
    assert(Array.isArray(skills));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

await test('agent filter works', async () => {
  const tempDir = await createTempDir();
  try {
    await createSkillDir(tempDir, 'test-skill', {
      name: 'test-skill',
      description: 'Test skill',
    });

    // Filter by a specific agent (even if not installed, should still return skill)
    const skills = await listInstalledSkills({ 
      global: false, 
      cwd: tempDir,
      agentFilter: ['cursor'] as any
    });
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0]!.name, 'test-skill');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

  // Summary
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
