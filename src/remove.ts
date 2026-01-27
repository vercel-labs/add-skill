import * as p from '@clack/prompts';
import chalk from 'chalk';
import { rm, access, lstat, readlink, readdir } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { agents, detectInstalledAgents } from './agents.js';
import { getInstallPath, getCanonicalPath, isSkillInstalled } from './installer.js';
import { removeSkillFromLock, getSkillFromLock } from './skill-lock.js';
import type { AgentType } from './types.js';

const RESET = '\x1b[0m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const RED = '\x1b[31m';

export interface RemoveOptions {
  global: boolean;
  agents: AgentType[];
  yes: boolean;
  all: boolean;
  cwd: string;
}

export function parseRemoveOptions(args: string[]): { skillName: string; options: RemoveOptions } {
  const options: RemoveOptions = {
    global: true, // Default to global
    agents: [],
    yes: false,
    all: false,
    cwd: process.cwd(),
  };

  let skillName = '';
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) {
      i++;
      continue;
    }

    if (arg === '-g' || arg === '--global') {
      options.global = true;
      i++;
    } else if (arg === '-l' || arg === '--local') {
      options.global = false;
      i++;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
      i++;
    } else if (arg === '--all') {
      options.all = true;
      i++;
    } else if (arg === '-a' || arg === '--agent') {
      i++;
      // Collect all following args until we hit another flag
      while (i < args.length) {
        const nextArg = args[i];
        if (nextArg === undefined || nextArg.startsWith('-')) break;
        options.agents.push(nextArg as AgentType);
        i++;
      }
    } else if (!arg.startsWith('-')) {
      skillName = arg;
      i++;
    } else {
      i++;
    }
  }

  return { skillName, options };
}

/**
 * Wrapper around p.multiselect that adds a hint for keyboard usage.
 */
function multiselect<Value>(opts: {
  message: string;
  options: Array<{ value: Value; label: string; hint?: string }>;
  initialValues?: Value[];
  required?: boolean;
}) {
  return p.multiselect({
    ...opts,
    options: opts.options as p.Option<Value>[],
    message: `${opts.message} ${chalk.dim('(space to toggle)')}`,
  }) as Promise<Value[] | symbol>;
}

/**
 * Two-step agent selection for removal: first ask "all agents" or "select specific",
 * then show the multiselect only if user wants to select specific agents.
 */
async function selectAgentsInteractive(
  skillName: string,
  availableAgents: AgentType[],
  options: { global?: boolean }
): Promise<AgentType[] | symbol> {
  // First step: ask if user wants all agents or to select specific ones
  const removeChoice = await p.select({
    message: `Remove "${skillName}" from`,
    options: [
      {
        value: 'all',
        label: 'All agents (Recommended)',
        hint: `Remove from all ${availableAgents.length} agents that have it installed`,
      },
      {
        value: 'select',
        label: 'Select specific agents',
        hint: 'Choose which agents to remove from',
      },
    ],
  });

  if (p.isCancel(removeChoice)) {
    return removeChoice;
  }

  if (removeChoice === 'all') {
    return availableAgents;
  }

  // Second step: show multiselect for specific agent selection
  const agentChoices = availableAgents.map((a) => ({
    value: a,
    label: agents[a].displayName,
    hint: `${options.global ? agents[a].globalSkillsDir : agents[a].skillsDir}`,
  }));

  const selected = await multiselect({
    message: 'Select agents to remove skill from',
    options: agentChoices,
    required: true,
    initialValues: [], // Start with none selected for easier picking
  });

  return selected as AgentType[] | symbol;
}

/**
 * Find which agents have this skill installed.
 */
async function findAgentsWithSkill(
  skillName: string,
  options: { global: boolean; cwd: string }
): Promise<AgentType[]> {
  const installedAgents = await detectInstalledAgents();
  const agentsWithSkill: AgentType[] = [];

  for (const agentType of installedAgents) {
    if (await isSkillInstalled(skillName, agentType, options)) {
      agentsWithSkill.push(agentType);
    }
  }

  return agentsWithSkill;
}

/**
 * Remove skill directory for a specific agent.
 */
async function removeSkillFromAgent(
  skillName: string,
  agentType: AgentType,
  options: { global: boolean; cwd: string }
): Promise<{ success: boolean; path: string; error?: string }> {
  const installPath = getInstallPath(skillName, agentType, options);

  try {
    await access(installPath);
    await rm(installPath, { recursive: true, force: true });
    return { success: true, path: installPath };
  } catch (error) {
    return {
      success: false,
      path: installPath,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Main remove command entry point.
 */
export async function runRemove(skillName: string, options: RemoveOptions): Promise<void> {
  // Validate skill name provided
  if (!skillName) {
    console.log(`${RED}Error:${RESET} Please provide a skill name to remove.`);
    console.log();
    console.log(`${DIM}Usage:${RESET} npx skills remove <skill-name>`);
    console.log();
    console.log(`${DIM}Examples:${RESET}`);
    console.log(`  ${DIM}$${RESET} npx skills remove ai-sdk`);
    console.log(`  ${DIM}$${RESET} npx skills remove ai-sdk --agent claude-code`);
    console.log(`  ${DIM}$${RESET} npx skills remove ai-sdk --all`);
    process.exit(1);
  }

  const installOptions = { global: options.global, cwd: options.cwd };

  // Find which agents have this skill installed
  let targetAgents: AgentType[];

  if (options.agents.length > 0) {
    // User specified agents directly
    targetAgents = options.agents;

    // Validate that these agents actually have the skill
    const invalid: AgentType[] = [];
    for (const agent of targetAgents) {
      if (!(await isSkillInstalled(skillName, agent, installOptions))) {
        invalid.push(agent);
      }
    }

    if (invalid.length === targetAgents.length) {
      p.log.error(`Skill "${skillName}" is not installed for any of the specified agents.`);

      // Check if it's installed elsewhere
      const agentsWithSkill = await findAgentsWithSkill(skillName, installOptions);
      if (agentsWithSkill.length > 0) {
        p.log.info(
          `The skill is installed for: ${agentsWithSkill.map((a) => chalk.cyan(agents[a].displayName)).join(', ')}`
        );
      }
      process.exit(1);
    }

    if (invalid.length > 0) {
      p.log.warn(
        `Skill not installed for: ${invalid.map((a) => agents[a].displayName).join(', ')}`
      );
      targetAgents = targetAgents.filter((a) => !invalid.includes(a));
    }
  } else {
    // Auto-detect agents with this skill
    const agentsWithSkill = await findAgentsWithSkill(skillName, installOptions);

    if (agentsWithSkill.length === 0) {
      p.log.error(`Skill "${skillName}" is not installed.`);

      // Check lock file for suggestion
      const lockEntry = await getSkillFromLock(skillName);
      if (lockEntry) {
        p.log.info(`The skill is tracked in the lock file but no installations found.`);
        p.log.info(`Source: ${chalk.dim(lockEntry.sourceUrl)}`);
      }

      // List available skills
      const canonicalDir = join(homedir(), '.agents', 'skills');
      try {
        const entries = await readdir(canonicalDir, { withFileTypes: true });
        const skills = entries
          .filter((e) => e.isDirectory() || e.isSymbolicLink())
          .map((e) => e.name);

        if (skills.length > 0) {
          console.log();
          console.log(`${DIM}Available skills:${RESET}`);
          for (const skill of skills.slice(0, 10)) {
            console.log(`  ${DIM}-${RESET} ${skill}`);
          }
          if (skills.length > 10) {
            console.log(`  ${DIM}... and ${skills.length - 10} more${RESET}`);
          }
        }
      } catch {
        // Directory doesn't exist
      }

      process.exit(1);
    }

    if (agentsWithSkill.length === 1 || options.all) {
      // Only one agent or --all flag, use all
      targetAgents = agentsWithSkill;
      p.log.info(
        `Removing from: ${agentsWithSkill.map((a) => chalk.cyan(agents[a].displayName)).join(', ')}`
      );
    } else {
      // Multiple agents, use interactive selection
      const selected = await selectAgentsInteractive(skillName, agentsWithSkill, {
        global: options.global,
      });

      if (p.isCancel(selected)) {
        p.cancel('Removal cancelled');
        process.exit(0);
      }

      if (!selected || (selected as AgentType[]).length === 0) {
        p.cancel('No agents selected');
        process.exit(0);
      }

      targetAgents = selected as AgentType[];
    }
  }

  // Check if canonical directory will be removed
  const canonicalPath = getCanonicalPath(skillName, installOptions);
  let willRemoveCanonical = false;

  // After removing from target agents, check if any other agents still reference it
  const allAgentsWithSkill = await findAgentsWithSkill(skillName, installOptions);
  const remainingAgents = allAgentsWithSkill.filter((a) => !targetAgents.includes(a));

  if (remainingAgents.length === 0) {
    willRemoveCanonical = true;
  }

  // Show summary and confirm deletion
  if (!options.yes) {
    console.log();
    p.log.step(`Will remove skill "${chalk.bold(skillName)}" from:`);
    for (const agent of targetAgents) {
      const installPath = getInstallPath(skillName, agent, installOptions);
      console.log(`  ${chalk.cyan('•')} ${agents[agent].displayName}`);
      console.log(`    ${chalk.dim(installPath)}`);
    }

    if (willRemoveCanonical) {
      console.log();
      console.log(`  ${chalk.yellow('+')} Canonical directory will also be removed:`);
      console.log(`    ${chalk.dim(canonicalPath)}`);
    }

    const confirmed = await p.confirm({
      message: 'Proceed with removal?',
      initialValue: false,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Removal cancelled');
      process.exit(0);
    }
  }

  // Remove from each target agent
  const s = p.spinner();
  s.start(`Removing ${skillName}...`);

  let successCount = 0;
  let failCount = 0;
  const results: Array<{ agent: AgentType; success: boolean; error?: string }> = [];

  for (const agent of targetAgents) {
    const result = await removeSkillFromAgent(skillName, agent, installOptions);

    if (result.success) {
      successCount++;
      results.push({ agent, success: true });
    } else {
      failCount++;
      results.push({ agent, success: false, error: result.error });
    }
  }

  // Remove canonical directory if no agents reference it anymore
  let canonicalRemoved = false;
  let lockRemoved = false;

  if (willRemoveCanonical) {
    try {
      await access(canonicalPath);
      await rm(canonicalPath, { recursive: true, force: true });
      canonicalRemoved = true;
    } catch {
      // Canonical doesn't exist, that's fine
    }

    // Remove from lock file
    lockRemoved = await removeSkillFromLock(skillName);
  }

  s.stop(`Removed ${skillName}`);

  // Show results
  console.log();
  for (const result of results) {
    if (result.success) {
      p.log.success(`Removed from ${chalk.cyan(agents[result.agent].displayName)}`);
    } else {
      p.log.error(`Failed to remove from ${agents[result.agent].displayName}`);
      if (result.error) {
        console.log(`  ${chalk.dim(result.error)}`);
      }
    }
  }

  if (canonicalRemoved) {
    p.log.success(`Removed canonical directory`);
  }

  if (lockRemoved) {
    p.log.success(`Removed from lock file`);
  }

  if (!willRemoveCanonical && remainingAgents.length > 0) {
    p.log.info(
      `Canonical directory kept (still used by ${remainingAgents.map((a) => agents[a].displayName).join(', ')})`
    );
  }

  console.log();

  if (failCount === 0) {
    p.outro(`Successfully removed "${skillName}"`);
  } else {
    p.outro(`Removed from ${successCount} agent(s), failed for ${failCount}`);
  }
}
