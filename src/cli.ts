#!/usr/bin/env node

import { spawn, spawnSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { basename, join, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { runAdd, parseAddOptions, initTelemetry } from './add.ts';
import { runFind } from './find.ts';
import { runList } from './list.ts';
import { removeCommand, parseRemoveOptions } from './remove.ts';
import { track } from './telemetry.ts';
import { runConfig } from './config-command.ts';

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
    `  ${DIM}$${RESET} ${TEXT}npx skills add ${DIM}<package>${RESET}   ${DIM}Install a skill${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills list${RESET}            ${DIM}List installed skills${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills find ${DIM}[query]${RESET}    ${DIM}Search for skills${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills check${RESET}           ${DIM}Check for updates${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills update${RESET}          ${DIM}Update all skills${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills remove${RESET}          ${DIM}Remove installed skills${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills init ${DIM}[name]${RESET}     ${DIM}Create a new skill${RESET}`
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
  add <package>     Add a skill package
                    e.g. vercel-labs/agent-skills
                         https://github.com/vercel-labs/agent-skills
  remove [skills]   Remove installed skills
  list, ls          List installed skills
  find [query]      Search for skills interactively
  init [name]       Initialize a skill (creates <name>/SKILL.md or ./SKILL.md)
  config            Configure custom skill paths
  check             Check for available skill updates
  update            Update all skills to latest versions

${BOLD}Add Options:${RESET}
  -g, --global           Install skill globally (user-level) instead of project-level
  -a, --agent <agents>   Specify agents to install to (use '*' for all agents)
  -s, --skill <skills>   Specify skill names to install (use '*' for all skills)
  -l, --list             List available skills in the repository without installing
  -y, --yes              Skip confirmation prompts
  --all                  Shorthand for --skill '*' --agent '*' -y
  --full-depth           Search all subdirectories even when a root SKILL.md exists

${BOLD}Remove Options:${RESET}
  -g, --global           Remove from global scope
  -a, --agent <agents>   Remove from specific agents (use '*' for all agents)
  -s, --skill <skills>   Specify skills to remove (use '*' for all skills)
  -y, --yes              Skip confirmation prompts
  --all                  Shorthand for --skill '*' --agent '*' -y
  
${BOLD}List Options:${RESET}
  -g, --global           List global skills (default: project)
  -a, --agent <agents>   Filter by specific agents

${BOLD}Options:${RESET}
  --help, -h        Show this help message
  --version, -v     Show version number

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} skills add vercel-labs/agent-skills
  ${DIM}$${RESET} skills add vercel-labs/agent-skills -g
  ${DIM}$${RESET} skills add vercel-labs/agent-skills --agent claude-code cursor
  ${DIM}$${RESET} skills add vercel-labs/agent-skills --skill pr-review commit
  ${DIM}$${RESET} skills remove                   ${DIM}# interactive remove${RESET}
  ${DIM}$${RESET} skills remove web-design        ${DIM}# remove by name${RESET}
  ${DIM}$${RESET} skills rm --global frontend-design
  ${DIM}$${RESET} skills list                     ${DIM}# list all installed skills${RESET}
  ${DIM}$${RESET} skills ls -g                    ${DIM}# list global skills only${RESET}
  ${DIM}$${RESET} skills ls -a claude-code        ${DIM}# filter by agent${RESET}
  ${DIM}$${RESET} skills find                     ${DIM}# interactive search${RESET}
  ${DIM}$${RESET} skills find typescript          ${DIM}# search by keyword${RESET}
  ${DIM}$${RESET} skills init my-skill
  ${DIM}$${RESET} skills check
  ${DIM}$${RESET} skills update

Discover more skills at ${TEXT}https://skills.sh/${RESET}
`);
}

function showRemoveHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} skills remove [skills...] [options]

${BOLD}Description:${RESET}
  Remove installed skills from agents. If no skill names are provided,
  an interactive selection menu will be shown.

${BOLD}Arguments:${RESET}
  skills            Optional skill names to remove (space-separated)

${BOLD}Options:${RESET}
  -g, --global       Remove from global scope (~/) instead of project scope
  -a, --agent        Remove from specific agents (use '*' for all agents)
  -s, --skill        Specify skills to remove (use '*' for all skills)
  -y, --yes          Skip confirmation prompts
  --all              Shorthand for --skill '*' --agent '*' -y

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} skills remove                           ${DIM}# interactive selection${RESET}
  ${DIM}$${RESET} skills remove my-skill                   ${DIM}# remove specific skill${RESET}
  ${DIM}$${RESET} skills remove skill1 skill2 -y           ${DIM}# remove multiple skills${RESET}
  ${DIM}$${RESET} skills remove --global my-skill          ${DIM}# remove from global scope${RESET}
  ${DIM}$${RESET} skills rm --agent claude-code my-skill   ${DIM}# remove from specific agent${RESET}
  ${DIM}$${RESET} skills remove --all                      ${DIM}# remove all skills${RESET}
  ${DIM}$${RESET} skills remove --skill '*' -a cursor      ${DIM}# remove all skills from cursor${RESET}

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
// Check and Update Commands
// ============================================

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.skill-lock.json';
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

async function runCheck(args: string[] = []): Promise<void> {
  console.log(`${TEXT}Checking for skill updates...${RESET}`);
  console.log();

  const lock = readSkillLock();
  const skillNames = Object.keys(lock.skills);

  if (skillNames.length === 0) {
    console.log(`${DIM}No skills tracked in lock file.${RESET}`);
    console.log(`${DIM}Install skills with${RESET} ${TEXT}npx skills add <package>${RESET}`);
    return;
  }

  const checkRequest: CheckUpdatesRequest = {
    skills: [],
  };

  for (const skillName of skillNames) {
    const entry = lock.skills[skillName];
    if (!entry) continue;

    // Skip skills without skillFolderHash (e.g., private repos where API can't fetch hash)
    if (!entry.skillFolderHash) {
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
      console.log(
        `${DIM}Could not check ${data.errors.length} skill(s) (may need reinstall)${RESET}`
      );
    }

    // Track telemetry
    track({
      event: 'check',
      skillCount: String(checkRequest.skills.length),
      updatesAvailable: String(data.updates.length),
    });
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

  const checkRequest: CheckUpdatesRequest = {
    skills: [],
  };

  for (const skillName of skillNames) {
    const entry = lock.skills[skillName];
    if (!entry) continue;

    // Skip skills without skillFolderHash (e.g., private repos where API can't fetch hash)
    if (!entry.skillFolderHash) {
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

  // Track telemetry
  track({
    event: 'update',
    skillCount: String(updates.length),
    successCount: String(successCount),
    failCount: String(failCount),
  });

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
    case 'remove':
    case 'rm':
    case 'r':
      // Check for --help or -h flag
      if (restArgs.includes('--help') || restArgs.includes('-h')) {
        showRemoveHelp();
        break;
      }
      const { skills, options: removeOptions } = parseRemoveOptions(restArgs);
      await removeCommand(skills, removeOptions);
      break;
    case 'list':
    case 'ls':
      await runList(restArgs);
      break;
    case 'config':
    case 'cfg':
      runConfig(restArgs);
      break;
    case 'check':
      runCheck(restArgs);
      break;
    case 'update':
    case 'upgrade':
      runUpdate();
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
