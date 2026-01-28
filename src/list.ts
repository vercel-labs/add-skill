import { homedir } from 'os';
import type { AgentType } from './types.ts';
import { agents } from './agents.ts';
import { listInstalledSkills, type InstalledSkill } from './installer.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';

interface ListOptions {
  global?: boolean;
  agent?: string[];
}

/**
 * Shortens a path for display: replaces homedir with ~ and cwd with .
 */
function shortenPath(fullPath: string, cwd: string): string {
  const home = homedir();
  if (fullPath.startsWith(home)) {
    return fullPath.replace(home, '~');
  }
  if (fullPath.startsWith(cwd)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

/**
 * Formats a list of items, truncating if too many
 */
function formatList(items: string[], maxShow: number = 5): string {
  if (items.length <= maxShow) {
    return items.join(', ');
  }
  const shown = items.slice(0, maxShow);
  const remaining = items.length - maxShow;
  return `${shown.join(', ')} +${remaining} more`;
}

export function parseListOptions(args: string[]): ListOptions {
  const options: ListOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      // Collect all following arguments until next flag
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        options.agent.push(args[++i]!);
      }
    }
  }

  return options;
}

export async function runList(args: string[]): Promise<void> {
  const options = parseListOptions(args);

  console.log(`${TEXT}Scanning for installed skills...${RESET}`);
  console.log();

  // Validate agent filter if provided
  let agentFilter: AgentType[] | undefined;
  if (options.agent && options.agent.length > 0) {
    const validAgents = Object.keys(agents);
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      console.log(`${YELLOW}Invalid agents: ${invalidAgents.join(', ')}${RESET}`);
      console.log(`${DIM}Valid agents: ${validAgents.join(', ')}${RESET}`);
      process.exit(1);
    }

    agentFilter = options.agent as AgentType[];
  }

  const installedSkills = await listInstalledSkills({
    global: options.global,
    agentFilter,
  });

  if (installedSkills.length === 0) {
    console.log(`${DIM}No installed skills found.${RESET}`);
    if (options.global === true) {
      console.log(`${DIM}Try listing project skills without --global${RESET}`);
    } else if (options.global === false) {
      console.log(`${DIM}Try listing global skills with --global${RESET}`);
    }
    console.log();
    console.log(`${DIM}Install skills with${RESET} ${TEXT}npx skills add <package>${RESET}`);
    return;
  }

  // Group by scope
  const projectSkills = installedSkills.filter((s) => s.scope === 'project');
  const globalSkills = installedSkills.filter((s) => s.scope === 'global');

  const cwd = process.cwd();

  function printSkill(skill: InstalledSkill, indent: string = ''): void {
    const shortPath = shortenPath(skill.canonicalPath, cwd);
    console.log(`${indent}${CYAN}${skill.name}${RESET}`);
    console.log(`${indent}  ${DIM}${skill.description}${RESET}`);
    console.log(`${indent}  ${DIM}Path:${RESET} ${shortPath}`);
    if (skill.agents.length > 0) {
      const agentNames = skill.agents.map((a) => agents[a].displayName);
      console.log(`${indent}  ${DIM}Agents:${RESET} ${formatList(agentNames)}`);
    } else {
      console.log(`${indent}  ${YELLOW}Not linked to any agents${RESET}`);
    }
  }

  // Show both scopes if not filtered
  if (options.global === undefined && projectSkills.length > 0 && globalSkills.length > 0) {
    if (projectSkills.length > 0) {
      console.log(`${BOLD}Project Skills${RESET} ${DIM}(${projectSkills.length})${RESET}`);
      console.log();
      for (const skill of projectSkills) {
        printSkill(skill, '  ');
        console.log();
      }
    }

    if (globalSkills.length > 0) {
      console.log(`${BOLD}Global Skills${RESET} ${DIM}(${globalSkills.length})${RESET}`);
      console.log();
      for (const skill of globalSkills) {
        printSkill(skill, '  ');
        console.log();
      }
    }
  } else {
    // Single scope or only one has results
    const skills = installedSkills;
    const scopeLabel =
      options.global === true
        ? 'Global'
        : options.global === false
          ? 'Project'
          : projectSkills.length > 0
            ? 'Project'
            : 'Global';

    console.log(`${BOLD}${scopeLabel} Skills${RESET} ${DIM}(${skills.length})${RESET}`);
    console.log();
    for (const skill of skills) {
      printSkill(skill, '  ');
      console.log();
    }
  }

  console.log(
    `${GREEN}Found ${installedSkills.length} skill${installedSkills.length !== 1 ? 's' : ''}${RESET}`
  );
  console.log();
}
