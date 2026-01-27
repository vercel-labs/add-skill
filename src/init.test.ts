import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCliOutput, stripLogo } from './test-utils.ts';

describe('init command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should initialize a skill and create SKILL.md', () => {
    const output = stripLogo(runCliOutput(['init', 'my-test-skill'], testDir));
    expect(output).toMatchInlineSnapshot(`
      "Initialized skill: my-test-skill

      Created:
        my-test-skill/SKILL.md

      Next steps:
        1. Edit my-test-skill/SKILL.md to define your skill instructions
        2. Update the name and description in the frontmatter

      Publishing:
        GitHub:  Push to a repo, then npx skills add <owner>/<repo>
        URL:     Host the file, then npx skills add https://example.com/my-test-skill/SKILL.md

      Browse existing skills for inspiration at https://skills.sh/

      "
    `);

    const skillPath = join(testDir, 'my-test-skill', 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toMatchInlineSnapshot(`
      "---
      name: my-test-skill
      description: A brief description of what this skill does
      ---

      # my-test-skill

      Instructions for the agent to follow when this skill is activated.

      ## When to use

      Describe when this skill should be used.

      ## Instructions

      1. First step
      2. Second step
      3. Additional steps as needed
      "
    `);
  });

  it('should allow multiple skills in same directory', () => {
    runCliOutput(['init', 'hydration-fix'], testDir);
    runCliOutput(['init', 'waterfall-data-fetching'], testDir);

    expect(existsSync(join(testDir, 'hydration-fix', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(testDir, 'waterfall-data-fetching', 'SKILL.md'))).toBe(true);
  });

  it('should init SKILL.md in cwd when no name provided', () => {
    const output = stripLogo(runCliOutput(['init'], testDir));

    expect(output).toContain('Initialized skill:');
    expect(output).toContain('Created:\n  SKILL.md'); // directly in cwd, not in a subfolder
    expect(output).toContain('Publishing:');
    expect(output).toContain('GitHub:');
    expect(output).toContain('npx skills add <owner>/<repo>');
    expect(output).toContain('URL:');
    expect(output).toContain('npx skills add https://example.com/SKILL.md');
    expect(existsSync(join(testDir, 'SKILL.md'))).toBe(true);
  });

  it('should show publishing hints with skill path', () => {
    const output = stripLogo(runCliOutput(['init', 'my-skill'], testDir));

    expect(output).toContain('Publishing:');
    expect(output).toContain('GitHub:  Push to a repo, then npx skills add <owner>/<repo>');
    expect(output).toContain(
      'URL:     Host the file, then npx skills add https://example.com/my-skill/SKILL.md'
    );
  });

  it('should show error if skill already exists', () => {
    runCliOutput(['init', 'existing-skill'], testDir);
    const output = stripLogo(runCliOutput(['init', 'existing-skill'], testDir));
    expect(output).toMatchInlineSnapshot(`
      "Skill already exists at existing-skill/SKILL.md
      "
    `);
  });
});
