import { readFile, rm, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { runAdd } from './add.js';
import { readSkillLock, removeSkillFromLock } from './skill-lock.js';
import { agents } from './agents.js';
import type { AddOptions, InstallFromFileOptions } from './types.js';

const SKILLS_FILENAME = '.skills';
const AGENTS_DIR = '.agents';
const SKILLS_SUBDIR = 'skills';

/**
 * Represents a parsed entry from a .skills file.
 * Supports the format: source@skill1,skill2,skill3
 */
export interface SkillsFileEntry {
  /** The source (repo, URL, or local path) without skill filter */
  source: string;
  /** Optional list of specific skills to install from this source */
  skills?: string[];
}

export interface SkillsFileConfig {
  /** Path to the .skills file found */
  path: string;
  /** true if ~/.skills, false if ./.skills */
  isGlobal: boolean;
  /** List of skill sources parsed from the file (raw strings for backward compat) */
  sources: string[];
  /** Parsed entries with skill filters */
  entries: SkillsFileEntry[];
}

/**
 * Find the .skills file in the current directory or home directory.
 * Current directory takes precedence over home directory.
 * @returns The config if found, null otherwise
 */
export async function findSkillsFile(): Promise<SkillsFileConfig | null> {
  const cwd = process.cwd();
  const home = homedir();

  // Check current directory first (project-level)
  const localPath = join(cwd, SKILLS_FILENAME);
  try {
    await access(localPath);
    const { sources, entries } = await parseSkillsFileWithEntries(localPath);
    return {
      path: localPath,
      isGlobal: false,
      sources,
      entries,
    };
  } catch {
    // Not found in current directory
  }

  // Check home directory (global)
  const globalPath = join(home, SKILLS_FILENAME);
  try {
    await access(globalPath);
    const { sources, entries } = await parseSkillsFileWithEntries(globalPath);
    return {
      path: globalPath,
      isGlobal: true,
      sources,
      entries,
    };
  } catch {
    // Not found in home directory either
  }

  return null;
}

/**
 * Tokenize a string, respecting single and double quotes.
 * Returns an array of tokens with quotes stripped.
 *
 * Examples:
 *   "a b c"           -> ["a", "b", "c"]
 *   "a 'b c' d"       -> ["a", "b c", "d"]
 *   'a "b c" d'       -> ["a", "b c", "d"]
 *   "a 'b c'd"        -> ["a", "b cd"] (quote continues until closing quote)
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (inQuote) {
      if (char === inQuote) {
        // End of quoted section
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      // Start of quoted section
      inQuote = char;
    } else if (char === ' ' || char === '\t') {
      // Whitespace - end current token if any
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  // Don't forget the last token
  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Parse a source string into a SkillsFileEntry.
 * Supports the format: source skill1 skill2 'skill with spaces'
 *
 * Examples:
 *   vercel-labs/agent-skills                    -> { source: 'vercel-labs/agent-skills' }
 *   owner/repo my-skill                         -> { source: 'owner/repo', skills: ['my-skill'] }
 *   owner/repo skill1 skill2                    -> { source: 'owner/repo', skills: ['skill1', 'skill2'] }
 *   owner/repo 'skill with spaces' skill2       -> { source: 'owner/repo', skills: ['skill with spaces', 'skill2'] }
 *   https://github.com/o/r my-skill             -> { source: 'https://github.com/o/r', skills: ['my-skill'] }
 */
export function parseSkillsEntry(rawSource: string): SkillsFileEntry {
  const tokens = tokenize(rawSource);

  if (tokens.length === 0) {
    return { source: rawSource };
  }

  const source = tokens[0]!;

  if (tokens.length === 1) {
    return { source };
  }

  const skills = tokens.slice(1);
  return { source, skills };
}

/**
 * Parse a .skills file and return the list of sources.
 * - Reads file line by line
 * - Trims whitespace
 * - Skips empty lines and lines starting with #
 * @param filePath Path to the .skills file
 * @returns Array of source strings
 */
export async function parseSkillsFile(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const sources: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Skip comments
    if (trimmed.startsWith('#')) continue;

    sources.push(trimmed);
  }

  return sources;
}

/**
 * Parse a .skills file and return both raw sources and parsed entries.
 * @param filePath Path to the .skills file
 * @returns Object with sources array and entries array
 */
export async function parseSkillsFileWithEntries(filePath: string): Promise<{
  sources: string[];
  entries: SkillsFileEntry[];
}> {
  const sources = await parseSkillsFile(filePath);
  const entries = sources.map(parseSkillsEntry);
  return { sources, entries };
}

/**
 * Get list of installed skill names from the canonical .agents/skills directory
 */
async function getInstalledSkillNames(isGlobal: boolean): Promise<string[]> {
  const { readdir, stat } = await import('fs/promises');
  const baseDir = isGlobal ? homedir() : process.cwd();
  const skillsDir = join(baseDir, AGENTS_DIR, SKILLS_SUBDIR);
  const skillNames: string[] = [];

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
        try {
          const stats = await stat(skillMdPath);
          if (stats.isFile()) {
            skillNames.push(entry.name);
          }
        } catch {
          // No SKILL.md, check if directory has content
          try {
            const contents = await readdir(join(skillsDir, entry.name));
            if (contents.length > 0) {
              skillNames.push(entry.name);
            }
          } catch {
            // Skip
          }
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return skillNames;
}

/**
 * Remove a skill from all agent directories and the canonical location
 */
async function removeSkill(skillName: string, isGlobal: boolean): Promise<boolean> {
  const baseDir = isGlobal ? homedir() : process.cwd();

  // Remove from canonical location
  const canonicalPath = join(baseDir, AGENTS_DIR, SKILLS_SUBDIR, skillName);
  try {
    await rm(canonicalPath, { recursive: true, force: true });
  } catch {
    // Ignore if doesn't exist
  }

  // Remove from each agent's skills directory
  for (const [agentKey, agentConfig] of Object.entries(agents)) {
    const agentSkillsDir = isGlobal
      ? agentConfig.globalSkillsDir
      : join(process.cwd(), agentConfig.skillsDir);
    const agentSkillPath = join(agentSkillsDir, skillName);

    try {
      await rm(agentSkillPath, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  }

  // Remove from lock file
  await removeSkillFromLock(skillName);

  return true;
}

/**
 * Extract skill names from sources for comparison with installed skills.
 * This is a heuristic - for GitHub sources it extracts from the path,
 * for URLs it tries to extract from the source identifier.
 */
function extractExpectedSkillNames(
  sources: string[],
  installedResults: Map<string, string[]>
): Set<string> {
  const expected = new Set<string>();

  for (const source of sources) {
    // If we tracked what was installed from this source, use that
    const installed = installedResults.get(source);
    if (installed) {
      for (const name of installed) {
        expected.add(name);
      }
    }
  }

  return expected;
}

/**
 * Install skills from a .skills file
 */
export async function runInstallFromFile(options: InstallFromFileOptions = {}): Promise<void> {
  const spinner = p.spinner();

  spinner.start('Looking for .skills file...');
  const config = await findSkillsFile();

  if (!config) {
    spinner.stop(chalk.yellow('No .skills file found'));
    console.log();
    p.log.message(chalk.dim('Create a .skills file with one skill source per line:'));
    console.log();
    console.log(chalk.dim('  # .skills example'));
    console.log(chalk.dim('  vercel-labs/agent-skills'));
    console.log(chalk.dim('  owner/repo specific-skill'));
    console.log(chalk.dim("  owner/repo 'skill with spaces' another-skill"));
    console.log(chalk.dim('  https://docs.example.com/skill.md'));
    console.log(chalk.dim('  ./local-path/to/skill'));
    console.log();
    p.log.message(chalk.dim('Add skill names after the source to select specific skills.'));
    p.log.message(
      chalk.dim(
        `Place in current directory (./.skills) for project-level or home directory (~/.skills) for global.`
      )
    );
    console.log();
    return;
  }

  const scopeLabel = config.isGlobal ? 'global' : 'project';
  spinner.stop(`Found .skills file: ${chalk.cyan(config.path)} (${scopeLabel} scope)`);

  if (config.sources.length === 0) {
    console.log();
    p.log.warn('No skill sources found in .skills file');
    p.log.message(chalk.dim('Add skill sources (one per line) to install them.'));
    return;
  }

  console.log();
  p.log.info(
    `Found ${chalk.cyan(config.sources.length)} skill source${config.sources.length !== 1 ? 's' : ''} to install`
  );

  // Track installed skill names for sync functionality
  const installedSkillNames = new Map<string, string[]>();
  let successCount = 0;
  let failCount = 0;

  // Get initial list of installed skills before installing (for sync)
  const preInstalledSkills = options.sync ? await getInstalledSkillNames(config.isGlobal) : [];

  // Install each source using parsed entries
  for (const entry of config.entries) {
    const displaySource = entry.skills ? `${entry.source}@${entry.skills.join(',')}` : entry.source;

    console.log();
    p.log.step(`Installing: ${chalk.cyan(displaySource)}`);

    try {
      // Create options for this installation
      const installOptions: AddOptions = {
        ...options,
        global: config.isGlobal,
        yes: true, // Auto-confirm in file mode
      };

      // If specific skills are requested, pass them via the skill option
      if (entry.skills && entry.skills.length > 0) {
        installOptions.skill = entry.skills;
      }

      // Run the add command for this source (without the @skills suffix)
      await runAdd([entry.source], installOptions);
      successCount++;

      // Track the skill names for sync functionality
      if (entry.skills && entry.skills.length > 0) {
        if (!installedSkillNames.has(entry.source)) {
          installedSkillNames.set(entry.source, []);
        }
        for (const skill of entry.skills) {
          installedSkillNames.get(entry.source)!.push(skill);
        }
      }
    } catch (error) {
      failCount++;
      p.log.error(
        `Failed to install ${chalk.cyan(displaySource)}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  console.log();
  if (successCount > 0) {
    p.log.success(`Installed ${successCount} skill source${successCount !== 1 ? 's' : ''}`);
  }
  if (failCount > 0) {
    p.log.warn(`Failed to install ${failCount} skill source${failCount !== 1 ? 's' : ''}`);
  }

  // Handle --sync: remove skills not in .skills file
  if (options.sync) {
    console.log();
    spinner.start('Syncing installed skills...');

    // Get current list of installed skills after installation
    const postInstalledSkills = await getInstalledSkillNames(config.isGlobal);

    // Get skills from lock file to determine which ones came from the .skills file sources
    const lock = await readSkillLock();
    const lockedSkillNames = new Set(Object.keys(lock.skills));

    // Build a set of clean sources (without @skills suffix) and a map of skill filters
    const sourcesSet = new Set(config.entries.map((e) => e.source));
    const skillFilters = new Map<string, string[]>();
    for (const entry of config.entries) {
      if (entry.skills && entry.skills.length > 0) {
        skillFilters.set(entry.source, entry.skills);
      }
    }

    const skillsToKeep = new Set<string>();

    for (const [skillName, lockEntry] of Object.entries(lock.skills)) {
      // Check if this skill's source is in the .skills file
      if (sourcesSet.has(lockEntry.source) || sourcesSet.has(lockEntry.sourceUrl)) {
        // If there's a skill filter for this source, only keep if skill is in the filter
        const filter = skillFilters.get(lockEntry.source) || skillFilters.get(lockEntry.sourceUrl);
        if (filter) {
          // Check if skill name matches any in the filter (case-insensitive)
          const matches = filter.some(
            (f) =>
              skillName.toLowerCase() === f.toLowerCase() ||
              skillName.toLowerCase().includes(f.toLowerCase()) ||
              f.toLowerCase().includes(skillName.toLowerCase())
          );
          if (matches) {
            skillsToKeep.add(skillName);
          }
        } else {
          // No filter means keep all skills from this source
          skillsToKeep.add(skillName);
        }
      }
      // Also check if source matches a pattern like owner/repo
      for (const source of sourcesSet) {
        if (lockEntry.source.includes(source) || source.includes(lockEntry.source)) {
          const filter = skillFilters.get(source);
          if (filter) {
            const matches = filter.some(
              (f) =>
                skillName.toLowerCase() === f.toLowerCase() ||
                skillName.toLowerCase().includes(f.toLowerCase()) ||
                f.toLowerCase().includes(skillName.toLowerCase())
            );
            if (matches) {
              skillsToKeep.add(skillName);
            }
          } else {
            skillsToKeep.add(skillName);
          }
        }
      }
    }

    // Find skills to remove (installed but not in keep list)
    const skillsToRemove = postInstalledSkills.filter(
      (name) => lockedSkillNames.has(name) && !skillsToKeep.has(name)
    );

    if (skillsToRemove.length === 0) {
      spinner.stop('All skills in sync');
    } else {
      spinner.stop(
        `Found ${skillsToRemove.length} skill${skillsToRemove.length !== 1 ? 's' : ''} to remove`
      );

      for (const skillName of skillsToRemove) {
        p.log.info(`Removing: ${chalk.yellow(skillName)}`);
        await removeSkill(skillName, config.isGlobal);
      }

      p.log.success(
        `Removed ${skillsToRemove.length} skill${skillsToRemove.length !== 1 ? 's' : ''} not in .skills file`
      );
    }
  }

  console.log();
  p.outro(chalk.green('Done!'));
}
