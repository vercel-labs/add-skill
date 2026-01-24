#!/usr/bin/env node

import { spawn, spawnSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { basename, join, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import * as readline from 'readline';
import { runAdd, parseAddOptions, initTelemetry } from './add.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const VERSION = getVersion();
initTelemetry(VERSION);

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
// 256-color grays - visible on both light and dark backgrounds
const DIM = '\x1b[38;5;102m'; // darker gray for secondary text
const TEXT = '\x1b[38;5;145m'; // lighter gray for primary text

const LOGO_LINES = [
  '███████╗██╗  ██╗██╗██╗     ██╗     ███████╗',
  '██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝',
  '███████╗█████╔╝ ██║██║     ██║     ███████╗',
  '╚════██║██╔═██╗ ██║██║     ██║     ╚════██║',
  '███████║██║  ██╗██║███████╗███████╗███████║',
  '╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝',
];

// 256-color middle grays - visible on both light and dark backgrounds
const GRAYS = [
  '\x1b[38;5;250m', // lighter gray
  '\x1b[38;5;248m',
  '\x1b[38;5;245m', // mid gray
  '\x1b[38;5;243m',
  '\x1b[38;5;240m',
  '\x1b[38;5;238m', // darker gray
];

// API endpoint for skills search
const SEARCH_API_BASE = process.env.SKILLS_API_URL || 'https://skills.sh';

interface SearchSkill {
  name: string;
  slug: string;
  source: string;
  installs: number;
}

// Search via API
async function searchSkillsAPI(query: string): Promise<SearchSkill[]> {
  try {
    const url = `${SEARCH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=10`;
    const res = await fetch(url);

    if (!res.ok) return [];

    const data = (await res.json()) as {
      skills: Array<{
        id: string;
        name: string;
        installs: number;
        topSource: string | null;
      }>;
    };

    return data.skills.map((skill) => ({
      name: skill.name,
      slug: skill.id,
      source: skill.topSource || '',
      installs: skill.installs,
    }));
  } catch {
    return [];
  }
}

// ANSI escape codes for terminal control
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_DOWN = '\x1b[J'; // Clear from cursor to end of screen
const MOVE_UP = (n: number) => `\x1b[${n}A`;
const MOVE_TO_COL = (n: number) => `\x1b[${n}G`;

// Custom fzf-style search prompt using raw readline
async function runSearchPrompt(initialQuery = ''): Promise<SearchSkill | null> {
  let results: SearchSkill[] = [];
  let selectedIndex = 0;
  let query = initialQuery;
  let loading = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRenderedLines = 0;

  // Enable raw mode for keypress events
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  // Setup readline for keypress events but don't let it echo
  readline.emitKeypressEvents(process.stdin);

  // Resume stdin to start receiving events
  process.stdin.resume();

  // Hide cursor during selection
  process.stdout.write(HIDE_CURSOR);

  function render(): void {
    // Move cursor up to overwrite previous render
    if (lastRenderedLines > 0) {
      process.stdout.write(MOVE_UP(lastRenderedLines) + MOVE_TO_COL(1));
    }

    // Clear from cursor to end of screen (removes ghost trails)
    process.stdout.write(CLEAR_DOWN);

    const lines: string[] = [];

    // Search input line with cursor
    const cursor = `${BOLD}_${RESET}`;
    lines.push(`${TEXT}Search skills:${RESET} ${query}${cursor}`);
    lines.push('');

    // Results - keep showing existing results while loading new ones
    if (!query || query.length < 2) {
      lines.push(`${DIM}Start typing to search (min 2 chars)${RESET}`);
    } else if (results.length === 0 && loading) {
      lines.push(`${DIM}Searching...${RESET}`);
    } else if (results.length === 0) {
      lines.push(`${DIM}No skills found${RESET}`);
    } else {
      const maxVisible = 8;
      const visible = results.slice(0, maxVisible);

      for (let i = 0; i < visible.length; i++) {
        const skill = visible[i]!;
        const isSelected = i === selectedIndex;
        const arrow = isSelected ? `${BOLD}>${RESET}` : ' ';
        const name = isSelected ? `${BOLD}${skill.name}${RESET}` : `${TEXT}${skill.name}${RESET}`;
        const source = skill.source ? ` ${DIM}${skill.source}${RESET}` : '';
        const loadingIndicator = loading && i === 0 ? ` ${DIM}...${RESET}` : '';

        lines.push(`  ${arrow} ${name}${source}${loadingIndicator}`);
      }
    }

    lines.push('');
    lines.push(`${DIM}up/down navigate | enter select | esc cancel${RESET}`);

    // Write each line
    for (const line of lines) {
      process.stdout.write(line + '\n');
    }

    lastRenderedLines = lines.length;
  }

  function triggerSearch(q: string): void {
    // Always clear any pending debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Always reset loading state when starting a new search
    loading = false;

    if (!q || q.length < 2) {
      results = [];
      selectedIndex = 0;
      render();
      return;
    }

    // Use API search for all queries (debounced)
    loading = true;
    render();

    debounceTimer = setTimeout(async () => {
      try {
        results = await searchSkillsAPI(q);
        selectedIndex = 0;
      } catch {
        results = [];
      } finally {
        loading = false;
        debounceTimer = null;
        render();
      }
    }, 150); // Short debounce for responsive feel
  }

  // Trigger initial search if there's a query, then render
  if (initialQuery) {
    triggerSearch(initialQuery);
  }
  render();

  return new Promise((resolve) => {
    function cleanup(): void {
      process.stdin.removeListener('keypress', handleKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdout.write(SHOW_CURSOR);
      // Pause stdin to fully release it for child processes
      process.stdin.pause();
    }

    function handleKeypress(_ch: string | undefined, key: readline.Key): void {
      if (!key) return;

      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        // Cancel
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === 'return') {
        // Submit
        cleanup();
        resolve(results[selectedIndex] || null);
        return;
      }

      if (key.name === 'up') {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
        return;
      }

      if (key.name === 'down') {
        selectedIndex = Math.min(Math.max(0, results.length - 1), selectedIndex + 1);
        render();
        return;
      }

      if (key.name === 'backspace') {
        if (query.length > 0) {
          query = query.slice(0, -1);
          triggerSearch(query);
        }
        return;
      }

      // Regular character input
      if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
        const char = key.sequence;
        if (char >= ' ' && char <= '~') {
          query += char;
          triggerSearch(query);
        }
      }
    }

    process.stdin.on('keypress', handleKeypress);
  });
}

// Parse owner/repo from a package string (for the find command)
function getOwnerRepoFromString(pkg: string): { owner: string; repo: string } | null {
  // Handle owner/repo or owner/repo@skill
  const atIndex = pkg.lastIndexOf('@');
  const repoPath = atIndex > 0 ? pkg.slice(0, atIndex) : pkg;
  const match = repoPath.match(/^([^/]+)\/([^/]+)$/);
  if (match) {
    return { owner: match[1]!, repo: match[2]! };
  }
  return null;
}

async function isRepoPublic(owner: string, repo: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    return res.ok;
  } catch {
    return false;
  }
}

async function runFind(args: string[]): Promise<void> {
  const query = args.join(' ');

  // Non-interactive mode: just print results and exit
  if (query) {
    const results = await searchSkillsAPI(query);

    if (results.length === 0) {
      console.log(`${DIM}No skills found for "${query}"${RESET}`);
      return;
    }

    console.log(`${DIM}Install with${RESET} npx skills add <owner/repo@skill>`);
    console.log();

    for (const skill of results.slice(0, 6)) {
      const pkg = skill.source || skill.slug;
      console.log(`${TEXT}${pkg}@${skill.name}${RESET}`);
      console.log(`${DIM}└ https://skills.sh/${pkg}/${skill.slug}${RESET}`);
      console.log();
    }
    return;
  }

  // Interactive mode
  const selected = await runSearchPrompt();

  if (!selected) {
    console.log(`${DIM}Search cancelled${RESET}`);
    console.log();
    return;
  }

  // Use source (owner/repo) and skill name for installation
  const pkg = selected.source || selected.slug;
  const skillName = selected.name;

  console.log();
  console.log(`${TEXT}Installing ${BOLD}${skillName}${RESET} from ${DIM}${pkg}${RESET}...`);
  console.log();

  // Run add directly since we're in the same CLI
  const { source, options } = parseAddOptions([pkg, '--skill', skillName]);
  await runAdd(source, options);

  console.log();

  const info = getOwnerRepoFromString(pkg);
  if (info && (await isRepoPublic(info.owner, info.repo))) {
    console.log(
      `${DIM}View the skill at${RESET} ${TEXT}https://skills.sh/${info.owner}/${info.repo}/${selected.slug}${RESET}`
    );
  } else {
    console.log(`${DIM}Discover more skills at${RESET} ${TEXT}https://skills.sh${RESET}`);
  }

  console.log();
}

function showLogo(): void {
  console.log();
  LOGO_LINES.forEach((line, i) => {
    console.log(`${GRAYS[i]}${line}${RESET}`);
  });
}

function showBanner(): void {
  showLogo();
  console.log();
  console.log(`${DIM}The open agent skills ecosystem${RESET}`);
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills add ${DIM}<package>${RESET}    ${DIM}Install a skill${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills find ${DIM}[query]${RESET}     ${DIM}Search for skills${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills check${RESET}            ${DIM}Check for updates${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills update${RESET}           ${DIM}Update all skills${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills init ${DIM}[name]${RESET}       ${DIM}Create a new skill${RESET}`
  );
  console.log();
  console.log(`${DIM}try:${RESET} npx skills add vercel-labs/agent-skills`);
  console.log();
  console.log(`Discover more skills at ${TEXT}https://skills.sh/${RESET}`);
  console.log();
}

function showHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} skills <command> [options]

${BOLD}Commands:${RESET}
  find [query]      Search for skills interactively
  init [name]       Initialize a skill (creates <name>/SKILL.md or ./SKILL.md)
  add <package>     Add a skill package
                    e.g. vercel-labs/agent-skills
                         https://github.com/vercel-labs/agent-skills
  check             Check for available skill updates
  update            Update all skills to latest versions
  generate-lock     Generate lock file from installed skills

${BOLD}Add Options:${RESET}
  -g, --global           Install skill globally (user-level) instead of project-level
  -a, --agent <agents>   Specify agents to install to
  -s, --skill <skills>   Specify skill names to install (skip selection prompt)
  -l, --list             List available skills in the repository without installing
  -y, --yes              Skip confirmation prompts
  --all                  Install all skills to all agents without any prompts

${BOLD}Options:${RESET}
  --help, -h        Show this help message
  --version, -v     Show version number
  --refresh, -r     Force refresh from source (check)
  --dry-run         Preview changes without writing (generate-lock)

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} skills find                     ${DIM}# interactive search${RESET}
  ${DIM}$${RESET} skills find typescript          ${DIM}# search by keyword${RESET}
  ${DIM}$${RESET} skills find "react testing"    ${DIM}# search by phrase${RESET}
  ${DIM}$${RESET} skills init my-skill
  ${DIM}$${RESET} skills add vercel-labs/agent-skills
  ${DIM}$${RESET} skills add vercel-labs/agent-skills -g
  ${DIM}$${RESET} skills add vercel-labs/agent-skills --agent claude-code cursor
  ${DIM}$${RESET} skills add vercel-labs/agent-skills --skill pr-review commit
  ${DIM}$${RESET} skills check
  ${DIM}$${RESET} skills update
  ${DIM}$${RESET} skills generate-lock --dry-run

Discover more skills at ${TEXT}https://skills.sh/${RESET}
`);
}

function runInit(args: string[]): void {
  const cwd = process.cwd();
  const skillName = args[0] || basename(cwd);
  const hasName = args[0] !== undefined;

  const skillDir = hasName ? join(cwd, skillName) : cwd;
  const skillFile = join(skillDir, 'SKILL.md');
  const displayPath = hasName ? `${skillName}/SKILL.md` : 'SKILL.md';

  if (existsSync(skillFile)) {
    console.log(`${TEXT}Skill already exists at ${DIM}${displayPath}${RESET}`);
    return;
  }

  if (hasName) {
    mkdirSync(skillDir, { recursive: true });
  }

  const skillContent = `---
name: ${skillName}
description: A brief description of what this skill does
---

# ${skillName}

Instructions for the agent to follow when this skill is activated.

## When to use

Describe when this skill should be used.

## Instructions

1. First step
2. Second step
3. Additional steps as needed
`;

  writeFileSync(skillFile, skillContent);

  console.log(`${TEXT}Initialized skill: ${DIM}${skillName}${RESET}`);
  console.log();
  console.log(`${DIM}Created:${RESET}`);
  console.log(`  ${displayPath}`);
  console.log();
  console.log(`${DIM}Next steps:${RESET}`);
  console.log(`  1. Edit ${TEXT}${displayPath}${RESET} to define your skill instructions`);
  console.log(
    `  2. Update the ${TEXT}name${RESET} and ${TEXT}description${RESET} in the frontmatter`
  );
  console.log();
  console.log(`${DIM}Publishing:${RESET}`);
  console.log(
    `  ${DIM}GitHub:${RESET}  Push to a repo, then ${TEXT}npx skills add <owner>/<repo>${RESET}`
  );
  console.log(
    `  ${DIM}URL:${RESET}     Host the file, then ${TEXT}npx skills add https://example.com/${displayPath}${RESET}`
  );
  console.log();
  console.log(`Browse existing skills for inspiration at ${TEXT}https://skills.sh/${RESET}`);
  console.log();
}

// ============================================
// Generate Lock Command
// ============================================

const AGENTS_DIR = '.agents';
const SKILLS_SUBDIR = 'skills';
const LOCK_FILE = '.skill-lock.json';
const SEARCH_API_URL = 'https://skills.sh/api/skills/search';
const CHECK_UPDATES_API_URL = 'https://add-skill.vercel.sh/check-updates';
const CURRENT_LOCK_VERSION = 3; // Bumped from 2 to 3 for folder hash support

interface SkillLockEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  skillPath?: string;
  /** GitHub tree SHA for the entire skill folder (v3) */
  skillFolderHash: string;
  installedAt: string;
  updatedAt: string;
}

interface SkillLockFile {
  version: number;
  skills: Record<string, SkillLockEntry>;
}

interface CheckUpdatesRequest {
  skills: Array<{
    name: string;
    source: string;
    path?: string;
    skillFolderHash: string;
  }>;
}

interface CheckUpdatesResponse {
  updates: Array<{
    name: string;
    source: string;
    currentHash: string;
    latestHash: string;
  }>;
  errors?: Array<{
    name: string;
    source: string;
    error: string;
  }>;
}

interface MatchResult {
  source: string;
  skillId: string;
  name: string;
  installs: number;
  score: number;
  sourceUrl?: string;
}

interface SearchResponse {
  matches: Record<string, MatchResult | null>;
}

function getSkillLockPath(): string {
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

function readSkillLock(): SkillLockFile {
  const lockPath = getSkillLockPath();
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as SkillLockFile;
    if (typeof parsed.version !== 'number' || !parsed.skills) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    // If old version, wipe and start fresh (backwards incompatible change)
    // v3 adds skillFolderHash - we want fresh installs to populate it
    if (parsed.version < CURRENT_LOCK_VERSION) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    return parsed;
  } catch {
    return { version: CURRENT_LOCK_VERSION, skills: {} };
  }
}

function writeSkillLock(lock: SkillLockFile): void {
  const lockPath = getSkillLockPath();
  const dir = join(homedir(), AGENTS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf-8');
}

function getInstalledSkillNames(): string[] {
  const skillsDir = join(homedir(), AGENTS_DIR, SKILLS_SUBDIR);
  const skillNames: string[] = [];

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
        try {
          const stat = statSync(skillMdPath);
          if (stat.isFile()) {
            skillNames.push(entry.name);
          }
        } catch {
          // No SKILL.md, check if directory has content
          try {
            const contents = readdirSync(join(skillsDir, entry.name));
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

async function fuzzyMatchSkills(
  skillNames: string[],
  apiUrl: string = SEARCH_API_URL
): Promise<Record<string, MatchResult | null>> {
  if (skillNames.length === 0) return {};

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skills: skillNames }),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as SearchResponse;
  return data.matches;
}

function inferSourceType(source: string): string {
  if (source.startsWith('mintlify/')) return 'mintlify';
  if (source.startsWith('huggingface/')) return 'huggingface';
  return 'github';
}

function buildSourceUrl(source: string, sourceType: string): string {
  switch (sourceType) {
    case 'github':
      return `https://github.com/${source}.git`;
    case 'mintlify':
      return source;
    case 'huggingface':
      const parts = source.replace('huggingface/', '').split('/');
      return `https://huggingface.co/spaces/${parts.join('/')}`;
    default:
      return source;
  }
}

async function runGenerateLock(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');

  // Allow API URL override for testing
  const apiUrlIdx = args.indexOf('--api-url');
  const apiUrl = apiUrlIdx !== -1 && args[apiUrlIdx + 1] ? args[apiUrlIdx + 1] : SEARCH_API_URL;

  console.log(`${TEXT}Scanning for installed skills...${RESET}`);
  const installedSkills = getInstalledSkillNames();

  if (installedSkills.length === 0) {
    console.log(`${DIM}No installed skills found.${RESET}`);
    return;
  }

  console.log(`${DIM}Found ${installedSkills.length} installed skill(s)${RESET}`);
  console.log();

  // Read existing lock file
  const existingLock = readSkillLock();
  const existingCount = Object.keys(existingLock.skills).length;

  // Filter skills not already in lock file
  const skillsToMatch = installedSkills.filter((skill) => !(skill in existingLock.skills));

  if (skillsToMatch.length === 0) {
    console.log(`${TEXT}All skills already in lock file.${RESET}`);
    return;
  }

  console.log(`${TEXT}Matching ${skillsToMatch.length} skill(s) against database...${RESET}`);
  console.log();

  const matches = await fuzzyMatchSkills(skillsToMatch, apiUrl);

  // Build updated lock file (only exact matches)
  const now = new Date().toISOString();
  const updatedLock: SkillLockFile = { ...existingLock };
  let matchedCount = 0;
  let skippedCount = 0;

  const EXACT_MATCH_THRESHOLD = 1000;

  for (const skillName of skillsToMatch) {
    const match = matches[skillName];

    if (match && match.score >= EXACT_MATCH_THRESHOLD) {
      matchedCount++;
      const sourceType = inferSourceType(match.source);
      // Use sourceUrl from API if available (for mintlify etc), otherwise build it
      const sourceUrl = match.sourceUrl || buildSourceUrl(match.source, sourceType);

      console.log(`${TEXT}✓${RESET} ${skillName}`);
      console.log(`  ${DIM}source: ${match.source}${RESET}`);

      // Note: contentHash is empty for generate-lock; check command computes from disk
      updatedLock.skills[skillName] = {
        source: match.source,
        sourceType,
        sourceUrl,
        skillFolderHash: '', // Will be populated by server on first check
        installedAt: now,
        updatedAt: now,
      };
    } else {
      skippedCount++;
    }
  }

  console.log();
  console.log(`${TEXT}Matched:${RESET} ${matchedCount}`);
  console.log(`${DIM}Skipped: ${skippedCount} (no exact match)${RESET}`);
  console.log();

  if (matchedCount === 0) {
    console.log(`${DIM}No new skills to add to lock file.${RESET}`);
    return;
  }

  if (dryRun) {
    console.log(`${DIM}Dry run - no changes written${RESET}`);
    console.log();
    console.log(JSON.stringify(updatedLock, null, 2));
  } else {
    writeSkillLock(updatedLock);
    console.log(`${TEXT}Lock file updated:${RESET} ${DIM}~/.agents/.skill-lock.json${RESET}`);
  }
}

// ============================================
// Check and Update Commands
// ============================================

async function runCheck(args: string[] = []): Promise<void> {
  // Always use forceRefresh to avoid stale cache showing false updates
  // The --refresh flag is now a no-op but kept for backwards compatibility
  const forceRefresh = true;

  console.log(`${TEXT}Checking for skill updates...${RESET}`);
  console.log();

  const lock = readSkillLock();
  const skillNames = Object.keys(lock.skills);

  if (skillNames.length === 0) {
    console.log(`${DIM}No skills tracked in lock file.${RESET}`);
    console.log(`${DIM}Install skills with${RESET} ${TEXT}npx skills add <package>${RESET}`);
    return;
  }

  // Build request with current hashes (from lock file or computed from disk)
  const checkRequest: CheckUpdatesRequest & { forceRefresh?: boolean } = {
    skills: [],
  };

  if (forceRefresh) {
    checkRequest.forceRefresh = true;
  }

  for (const skillName of skillNames) {
    const entry = lock.skills[skillName];
    if (!entry) continue;

    // Skip skills without skillFolderHash (shouldn't happen with v3)
    if (!entry.skillFolderHash) {
      console.log(`${DIM}Skipping ${skillName}: no skillFolderHash (reinstall needed)${RESET}`);
      continue;
    }

    checkRequest.skills.push({
      name: skillName,
      source: entry.source,
      path: entry.skillPath,
      skillFolderHash: entry.skillFolderHash,
    });
  }

  if (checkRequest.skills.length === 0) {
    console.log(`${DIM}No skills to check.${RESET}`);
    return;
  }

  console.log(`${DIM}Checking ${checkRequest.skills.length} skill(s) for updates...${RESET}`);

  try {
    const response = await fetch(CHECK_UPDATES_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkRequest),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as CheckUpdatesResponse;

    console.log();

    if (data.updates.length === 0) {
      console.log(`${TEXT}✓ All skills are up to date${RESET}`);
    } else {
      console.log(`${TEXT}${data.updates.length} update(s) available:${RESET}`);
      console.log();
      for (const update of data.updates) {
        console.log(`  ${TEXT}↑${RESET} ${update.name}`);
        console.log(`    ${DIM}source: ${update.source}${RESET}`);
      }
      console.log();
      console.log(
        `${DIM}Run${RESET} ${TEXT}npx skills update${RESET} ${DIM}to update all skills${RESET}`
      );
    }

    if (data.errors && data.errors.length > 0) {
      console.log();
      console.log(`${DIM}Could not check ${data.errors.length} skill(s):${RESET}`);
      for (const err of data.errors) {
        console.log(`  ${DIM}${err.name}: ${err.error}${RESET}`);
      }
    }
  } catch (error) {
    console.log(
      `${TEXT}Error checking for updates:${RESET} ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  }

  console.log();
}

async function runUpdate(): Promise<void> {
  console.log(`${TEXT}Checking for skill updates...${RESET}`);
  console.log();

  const lock = readSkillLock();
  const skillNames = Object.keys(lock.skills);

  if (skillNames.length === 0) {
    console.log(`${DIM}No skills tracked in lock file.${RESET}`);
    console.log(`${DIM}Install skills with${RESET} ${TEXT}npx skills add <package>${RESET}`);
    return;
  }

  // Build request with current hashes
  // Always use forceRefresh for update to avoid stale cache issues
  const checkRequest: CheckUpdatesRequest & { forceRefresh?: boolean } = {
    skills: [],
    forceRefresh: true,
  };

  for (const skillName of skillNames) {
    const entry = lock.skills[skillName];
    if (!entry) continue;

    // Skip skills without skillFolderHash (shouldn't happen with v3)
    if (!entry.skillFolderHash) {
      console.log(`${DIM}Skipping ${skillName}: no skillFolderHash (reinstall needed)${RESET}`);
      continue;
    }

    checkRequest.skills.push({
      name: skillName,
      source: entry.source,
      path: entry.skillPath,
      skillFolderHash: entry.skillFolderHash,
    });
  }

  if (checkRequest.skills.length === 0) {
    console.log(`${DIM}No skills to check.${RESET}`);
    return;
  }

  // Check for updates (with forceRefresh to avoid stale cache)
  let updates: CheckUpdatesResponse['updates'] = [];
  try {
    const response = await fetch(CHECK_UPDATES_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkRequest),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as CheckUpdatesResponse;
    updates = data.updates;
  } catch (error) {
    console.log(
      `${TEXT}Error checking for updates:${RESET} ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  }

  if (updates.length === 0) {
    console.log(`${TEXT}✓ All skills are up to date${RESET}`);
    console.log();
    return;
  }

  console.log(`${TEXT}Found ${updates.length} update(s)${RESET}`);
  console.log();

  // Reinstall each skill that has an update
  let successCount = 0;
  let failCount = 0;

  for (const update of updates) {
    const entry = lock.skills[update.name];
    if (!entry) continue;

    console.log(`${TEXT}Updating ${update.name}...${RESET}`);

    // Use skills CLI to reinstall with -g -y flags
    const result = spawnSync(
      'npx',
      ['-y', 'skills', entry.sourceUrl, '--skill', update.name, '-g', '-y'],
      {
        stdio: ['inherit', 'pipe', 'pipe'],
      }
    );

    if (result.status === 0) {
      successCount++;
      console.log(`  ${TEXT}✓${RESET} Updated ${update.name}`);
    } else {
      failCount++;
      console.log(`  ${DIM}✗ Failed to update ${update.name}${RESET}`);
    }
  }

  console.log();
  if (successCount > 0) {
    console.log(`${TEXT}✓ Updated ${successCount} skill(s)${RESET}`);
  }
  if (failCount > 0) {
    console.log(`${DIM}Failed to update ${failCount} skill(s)${RESET}`);
  }
  console.log();
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showBanner();
    return;
  }

  const command = args[0];
  const restArgs = args.slice(1);

  switch (command) {
    case 'find':
    case 'search':
    case 'f':
    case 's':
      showLogo();
      console.log();
      await runFind(restArgs);
      break;
    case 'init':
      showLogo();
      console.log();
      runInit(restArgs);
      break;
    case 'i':
    case 'install':
    case 'a':
    case 'add': {
      showLogo();
      const { source, options } = parseAddOptions(restArgs);
      await runAdd(source, options);
      break;
    }
    case 'check':
      showLogo();
      console.log();
      runCheck(restArgs);
      break;
    case 'update':
    case 'upgrade':
      showLogo();
      console.log();
      runUpdate();
      break;
    case 'generate-lock':
    case 'gen-lock':
      showLogo();
      console.log();
      runGenerateLock(restArgs);
      break;
    case '--help':
    case '-h':
      showHelp();
      break;
    case '--version':
    case '-v':
      console.log(VERSION);
      break;

    default:
      console.log(`Unknown command: ${command}`);
      console.log(`Run ${BOLD}skills --help${RESET} for usage.`);
  }
}

main();
