import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { runCli } from './test-utils.js';
import { findSkillsFile, parseSkillsFile, parseSkillsEntry } from './skillsfile.js';

describe('skillsfile', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-file-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('parseSkillsEntry', () => {
    it('should parse source without skill filter', () => {
      const result = parseSkillsEntry('vercel-labs/agent-skills');
      expect(result).toEqual({
        source: 'vercel-labs/agent-skills',
      });
    });

    it('should parse source with single skill filter', () => {
      const result = parseSkillsEntry('owner/repo my-skill');
      expect(result).toEqual({
        source: 'owner/repo',
        skills: ['my-skill'],
      });
    });

    it('should parse source with multiple skill filters', () => {
      const result = parseSkillsEntry('owner/repo skill1 skill2 skill3');
      expect(result).toEqual({
        source: 'owner/repo',
        skills: ['skill1', 'skill2', 'skill3'],
      });
    });

    it('should handle quoted skill names with spaces', () => {
      const result = parseSkillsEntry("owner/repo 'skill with spaces' skill2");
      expect(result).toEqual({
        source: 'owner/repo',
        skills: ['skill with spaces', 'skill2'],
      });
    });

    it('should handle double-quoted skill names', () => {
      const result = parseSkillsEntry('owner/repo "skill with spaces" skill2');
      expect(result).toEqual({
        source: 'owner/repo',
        skills: ['skill with spaces', 'skill2'],
      });
    });

    it('should parse GitHub URL with skill filter', () => {
      const result = parseSkillsEntry('https://github.com/owner/repo my-skill');
      expect(result).toEqual({
        source: 'https://github.com/owner/repo',
        skills: ['my-skill'],
      });
    });

    it('should handle local paths without skill filter', () => {
      const result = parseSkillsEntry('./path/to/skill-dir');
      expect(result).toEqual({
        source: './path/to/skill-dir',
      });
    });

    it('should handle local paths with skill filter', () => {
      const result = parseSkillsEntry('./path/to/skills my-skill');
      expect(result).toEqual({
        source: './path/to/skills',
        skills: ['my-skill'],
      });
    });

    it('should handle GitHub shorthand with subpath and skill', () => {
      const result = parseSkillsEntry('owner/repo/subpath skill');
      expect(result).toEqual({
        source: 'owner/repo/subpath',
        skills: ['skill'],
      });
    });

    it('should handle multiple spaces between tokens', () => {
      const result = parseSkillsEntry('owner/repo   skill1    skill2');
      expect(result).toEqual({
        source: 'owner/repo',
        skills: ['skill1', 'skill2'],
      });
    });

    it('should handle tabs as separators', () => {
      const result = parseSkillsEntry('owner/repo\tskill1\tskill2');
      expect(result).toEqual({
        source: 'owner/repo',
        skills: ['skill1', 'skill2'],
      });
    });

    it('should preserve @ in source for future versioning', () => {
      const result = parseSkillsEntry('owner/repo@v2');
      expect(result).toEqual({
        source: 'owner/repo@v2',
      });
    });

    it('should handle versioned source with skills', () => {
      const result = parseSkillsEntry('owner/repo@v2 skill1 skill2');
      expect(result).toEqual({
        source: 'owner/repo@v2',
        skills: ['skill1', 'skill2'],
      });
    });
  });

  describe('parseSkillsFile', () => {
    it('should parse sources from .skills file', async () => {
      const skillsFile = join(testDir, '.skills');
      writeFileSync(
        skillsFile,
        `# This is a comment
vercel-labs/agent-skills
owner/repo specific-skill

# Another comment
https://docs.example.com/skill.md
./local-path/to/skill
`
      );

      const sources = await parseSkillsFile(skillsFile);
      expect(sources).toEqual([
        'vercel-labs/agent-skills',
        'owner/repo specific-skill',
        'https://docs.example.com/skill.md',
        './local-path/to/skill',
      ]);
    });

    it('should skip empty lines and comments', async () => {
      const skillsFile = join(testDir, '.skills');
      writeFileSync(
        skillsFile,
        `# Comment line
   # Comment with leading whitespace

source-one


source-two
`
      );

      const sources = await parseSkillsFile(skillsFile);
      expect(sources).toEqual(['source-one', 'source-two']);
    });

    it('should handle file with only comments', async () => {
      const skillsFile = join(testDir, '.skills');
      writeFileSync(
        skillsFile,
        `# Just comments
# More comments
`
      );

      const sources = await parseSkillsFile(skillsFile);
      expect(sources).toEqual([]);
    });

    it('should trim whitespace from sources', async () => {
      const skillsFile = join(testDir, '.skills');
      writeFileSync(
        skillsFile,
        `  vercel-labs/agent-skills
	owner/repo skill
`
      );

      const sources = await parseSkillsFile(skillsFile);
      expect(sources).toEqual(['vercel-labs/agent-skills', 'owner/repo skill']);
    });
  });

  describe('findSkillsFile', () => {
    it('should find .skills in current directory', async () => {
      const skillsFile = join(testDir, '.skills');
      writeFileSync(skillsFile, 'vercel-labs/agent-skills');

      process.chdir(testDir);
      const config = await findSkillsFile();

      expect(config).not.toBeNull();
      // Use toContain to avoid /private vs /var symlink issues on macOS
      expect(config!.path).toContain('.skills');
      expect(config!.isGlobal).toBe(false);
      expect(config!.sources).toEqual(['vercel-labs/agent-skills']);
      expect(config!.entries).toEqual([{ source: 'vercel-labs/agent-skills' }]);
    });

    it('should return null when no .skills file exists', async () => {
      process.chdir(testDir);
      const config = await findSkillsFile();
      expect(config).toBeNull();
    });

    it('should prefer local .skills over global', async () => {
      // Create local .skills
      const localSkillsFile = join(testDir, '.skills');
      writeFileSync(localSkillsFile, 'local-source');

      process.chdir(testDir);
      const config = await findSkillsFile();

      expect(config).not.toBeNull();
      expect(config!.isGlobal).toBe(false);
      expect(config!.sources).toEqual(['local-source']);
      expect(config!.entries).toEqual([{ source: 'local-source' }]);
    });

    it('should parse entries with skill filters', async () => {
      const skillsFile = join(testDir, '.skills');
      writeFileSync(
        skillsFile,
        `vercel-labs/agent-skills
owner/repo skill1 skill2
https://github.com/foo/bar my-skill
owner/repo@v2 'skill with spaces'
`
      );

      process.chdir(testDir);
      const config = await findSkillsFile();

      expect(config).not.toBeNull();
      expect(config!.entries).toEqual([
        { source: 'vercel-labs/agent-skills' },
        { source: 'owner/repo', skills: ['skill1', 'skill2'] },
        { source: 'https://github.com/foo/bar', skills: ['my-skill'] },
        { source: 'owner/repo@v2', skills: ['skill with spaces'] },
      ]);
    });
  });

  describe('install command', () => {
    it('should show message when no .skills file found', () => {
      const result = runCli(['install'], testDir);
      expect(result.stdout).toContain('No .skills file found');
      expect(result.stdout).toContain('Create a .skills file');
      expect(result.exitCode).toBe(0);
    });

    it('should show message for empty .skills file', () => {
      const skillsFile = join(testDir, '.skills');
      writeFileSync(skillsFile, '# Only comments\n');

      const result = runCli(['install'], testDir);
      expect(result.stdout).toContain('No skill sources found');
      expect(result.exitCode).toBe(0);
    });

    it('should find and parse .skills file in test directory', () => {
      const skillsFile = join(testDir, '.skills');
      writeFileSync(skillsFile, 'vercel-labs/agent-skills\n');

      const result = runCli(['install'], testDir);
      expect(result.stdout).toContain('.skills');
      expect(result.stdout).toContain('1 skill source');
    });
  });

  describe('--sync flag', () => {
    it('should be recognized in help output', () => {
      const result = runCli(['--help'], testDir);
      expect(result.stdout).toContain('--sync');
      expect(result.stdout).toContain('Remove skills not listed');
    });
  });
});
