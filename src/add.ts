import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { parseSource, getOwnerRepo } from './source-parser.ts';
import { cloneRepo, cleanupTempDir, GitCloneError } from './git.ts';
import { discoverSkills, getSkillDisplayName } from './skills.ts';
import {
  installSkillForAgent,
  isSkillInstalled,
  getInstallPath,
  getCanonicalPath,
  installRemoteSkillForAgent,
  installWellKnownSkillForAgent,
  type InstallMode,
} from './installer.ts';
import { detectInstalledAgents, agents } from './agents.ts';
import { track, setVersion } from './telemetry.ts';
import { findProvider, wellKnownProvider, type WellKnownSkill } from './providers/index.ts';
import { fetchMintlifySkill } from './mintlify.ts';
import {
  addSkillToLock,
  fetchSkillFolderHash,
  isPromptDismissed,
  dismissPrompt,
  getLastSelectedAgents,
  saveSelectedAgents,
} from './skill-lock.ts';
import type { Skill, AgentType, RemoteSkill } from './types.ts';
import packageJson from '../package.json' with { type: 'json' };
export function initTelemetry(version: string): void {
  setVersion(version);
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

/**
 * Wrapper around p.multiselect that adds a hint for keyboard usage.
 * Accepts options with required labels (matching our usage pattern).
 */
function multiselect<Value>(opts: {
  message: string;
  options: Array<{ value: Value; label: string; hint?: string }>;
  initialValues?: Value[];
  required?: boolean;
}) {
  return p.multiselect({
    ...opts,
    // Cast is safe: our options always have labels, which satisfies p.Option requirements
    options: opts.options as p.Option<Value>[],
    message: `${opts.message} ${pc.dim('(space to toggle)')}`,
  }) as Promise<Value[] | symbol>;
}

/**
 * Prompts the user to select agents, pre-selecting the last used agents if available.
 * Saves the selection for future use.
 */
export async function promptForAgents(
  message: string,
  choices: Array<{ value: AgentType; label: string; hint?: string }>,
  defaultToAll: boolean = false
): Promise<AgentType[] | symbol> {
  // Get last selected agents to pre-select, or default to all if specified
  let lastSelected: string[] | undefined;
  try {
    lastSelected = await getLastSelectedAgents();
  } catch {
    // Silently ignore errors reading lock file
  }

  const validAgents = choices.map((c) => c.value);

  let initialValues: AgentType[];

  if (lastSelected && lastSelected.length > 0) {
    // Filter stored agents against currently valid agents
    initialValues = lastSelected.filter((a) => validAgents.includes(a as AgentType)) as AgentType[];

    // If filtering results in empty list and we should default to all, do so
    if (initialValues.length === 0 && defaultToAll) {
      initialValues = validAgents;
    }
  } else {
    // No history, default to all or empty based on flag
    initialValues = defaultToAll ? validAgents : [];
  }

  const selected = await multiselect({
    message,
    options: choices,
    required: true,
    initialValues,
  });

  if (!p.isCancel(selected)) {
    // Save selection for next time
    try {
      await saveSelectedAgents(selected as string[]);
    } catch {
      // Silently ignore errors writing lock file
    }
  }

  return selected as AgentType[] | symbol;
}

/**
 * Two-step agent selection: first ask "all agents", "previously selected", or "select specific",
 * then show the multiselect only if user wants to select specific agents.
 */
async function selectAgentsInteractive(
  availableAgents: AgentType[],
  options: { global?: boolean }
): Promise<AgentType[] | symbol> {
  // Check if we have previously selected agents
  let lastSelected: string[] | undefined;
  try {
    lastSelected = await getLastSelectedAgents();
  } catch {
    // Silently ignore errors reading lock file
  }

  // Filter last selected to only include currently available agents
  const validLastSelected = lastSelected?.filter((a) =>
    availableAgents.includes(a as AgentType)
  ) as AgentType[] | undefined;

  // Build options list
  const selectOptions: Array<{ value: string; label: string; hint: string }> = [];
  const hasPrevious = validLastSelected && validLastSelected.length > 0;

  // Add "Same as last time" option first if we have valid history (recommended)
  if (hasPrevious) {
    const agentNames = validLastSelected.map((a) => agents[a].displayName).join(', ');
    selectOptions.push({
      value: 'previous',
      label: 'Same as last time (Recommended)',
      hint: agentNames,
    });
  }

  selectOptions.push({
    value: 'all',
    label: hasPrevious ? 'All detected agents' : 'All detected agents (Recommended)',
    hint: `Install to all ${availableAgents.length} detected agents`,
  });

  selectOptions.push({
    value: 'select',
    label: 'Select specific agents',
    hint: 'Choose which agents to install to',
  });

  // First step: ask if user wants all agents, previous selection, or to select specific ones
  const installChoice = await p.select({
    message: 'Install to',
    options: selectOptions,
  });

  if (p.isCancel(installChoice)) {
    return installChoice;
  }

  if (installChoice === 'all') {
    return availableAgents;
  }

  if (installChoice === 'previous' && validLastSelected) {
    return validLastSelected;
  }

  // Second step: show multiselect for specific agent selection
  const agentChoices = availableAgents.map((a) => ({
    value: a,
    label: agents[a].displayName,
    hint: `${options.global ? agents[a].globalSkillsDir : agents[a].skillsDir}`,
  }));

  // Use helper to prompt with memory
  return promptForAgents('Select agents to install skills to', agentChoices, false);
}

const version = packageJson.version;
setVersion(version);

export interface AddOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  skill?: string[];
  list?: boolean;
  all?: boolean;
}

/**
 * Handle remote skill installation from any supported host provider.
 * This is the generic handler for direct URL skills (Mintlify, HuggingFace, etc.)
 */
async function handleRemoteSkill(
  source: string,
  url: string,
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  // Find a provider that can handle this URL
  const provider = findProvider(url);

  if (!provider) {
    // Fall back to legacy Mintlify handling for backwards compatibility
    await handleDirectUrlSkillLegacy(source, url, options, spinner);
    return;
  }

  spinner.start(`Fetching skill.md from ${provider.displayName}...`);
  const providerSkill = await provider.fetchSkill(url);

  if (!providerSkill) {
    spinner.stop(pc.red('Invalid skill'));
    p.outro(
      pc.red('Could not fetch skill.md or missing required frontmatter (name, description).')
    );
    process.exit(1);
  }

  // Convert to RemoteSkill format with provider info
  const remoteSkill: RemoteSkill = {
    name: providerSkill.name,
    description: providerSkill.description,
    content: providerSkill.content,
    installName: providerSkill.installName,
    sourceUrl: providerSkill.sourceUrl,
    providerId: provider.id,
    sourceIdentifier: provider.getSourceIdentifier(url),
    metadata: providerSkill.metadata,
  };

  spinner.stop(`Found skill: ${pc.cyan(remoteSkill.installName)}`);

  p.log.info(`Skill: ${pc.cyan(remoteSkill.name)}`);
  p.log.message(pc.dim(remoteSkill.description));
  p.log.message(pc.dim(`Source: ${remoteSkill.sourceIdentifier}`));

  if (options.list) {
    console.log();
    p.log.step(pc.bold('Skill Details'));
    p.log.message(`  ${pc.cyan('Name:')} ${remoteSkill.name}`);
    p.log.message(`  ${pc.cyan('Install as:')} ${remoteSkill.installName}`);
    p.log.message(`  ${pc.cyan('Provider:')} ${provider.displayName}`);
    p.log.message(`  ${pc.cyan('Description:')} ${remoteSkill.description}`);
    console.log();
    p.outro('Run without --list to install');
    process.exit(0);
  }

  // Detect agents
  let targetAgents: AgentType[];
  const validAgents = Object.keys(agents);

  if (options.agent && options.agent.length > 0) {
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }

    targetAgents = options.agent as AgentType[];
  } else {
    spinner.start('Detecting installed agents...');
    const installedAgents = await detectInstalledAgents();
    spinner.stop(
      `Detected ${installedAgents.length} agent${installedAgents.length !== 1 ? 's' : ''}`
    );

    if (installedAgents.length === 0) {
      if (options.yes) {
        targetAgents = validAgents as AgentType[];
        p.log.info('Installing to all agents (none detected)');
      } else {
        p.log.warn('No coding agents detected. You can still install skills.');

        const allAgentChoices = Object.entries(agents).map(([key, config]) => ({
          value: key as AgentType,
          label: config.displayName,
        }));

        // Use helper to prompt with memory (defaulting to all)
        const selected = await promptForAgents(
          'Select agents to install skills to',
          allAgentChoices,
          true
        );

        if (p.isCancel(selected)) {
          p.cancel('Installation cancelled');
          process.exit(0);
        }

        targetAgents = selected as AgentType[];
      }
    } else if (installedAgents.length === 1 || options.yes) {
      targetAgents = installedAgents;
      if (installedAgents.length === 1) {
        const firstAgent = installedAgents[0]!;
        p.log.info(`Installing to: ${pc.cyan(agents[firstAgent].displayName)}`);
      } else {
        p.log.info(
          `Installing to: ${installedAgents.map((a) => pc.cyan(agents[a].displayName)).join(', ')}`
        );
      }
    } else {
      const selected = await selectAgentsInteractive(installedAgents, { global: options.global });

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        process.exit(0);
      }

      targetAgents = selected as AgentType[];
    }
  }

  let installGlobally = options.global ?? false;

  if (options.global === undefined && !options.yes) {
    const scope = await p.select({
      message: 'Installation scope',
      options: [
        {
          value: false,
          label: 'Project',
          hint: 'Install in current directory (committed with your project)',
        },
        {
          value: true,
          label: 'Global',
          hint: 'Install in home directory (available across all projects)',
        },
      ],
    });

    if (p.isCancel(scope)) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }

    installGlobally = scope as boolean;
  }

  // Prompt for install mode (symlink vs copy)
  let installMode: InstallMode = 'symlink';

  if (!options.yes) {
    const modeChoice = await p.select({
      message: 'Installation method',
      options: [
        {
          value: 'symlink',
          label: 'Symlink (Recommended)',
          hint: 'Single source of truth, easy updates',
        },
        { value: 'copy', label: 'Copy to all agents', hint: 'Independent copies for each agent' },
      ],
    });

    if (p.isCancel(modeChoice)) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }

    installMode = modeChoice as InstallMode;
  }

  const cwd = process.cwd();

  // Check for overwrites
  const overwriteStatus = new Map<string, boolean>();
  for (const agent of targetAgents) {
    overwriteStatus.set(
      agent,
      await isSkillInstalled(remoteSkill.installName, agent, {
        global: installGlobally,
      })
    );
  }

  // Build installation summary
  const summaryLines: string[] = [];
  const agentNames = targetAgents.map((a) => agents[a].displayName);

  if (installMode === 'symlink') {
    const canonicalPath = getCanonicalPath(remoteSkill.installName, { global: installGlobally });
    const shortCanonical = shortenPath(canonicalPath, cwd);
    summaryLines.push(`${pc.cyan(shortCanonical)}`);
    summaryLines.push(`  ${pc.dim('symlink →')} ${formatList(agentNames)}`);
  } else {
    summaryLines.push(`${pc.cyan(remoteSkill.installName)}`);
    summaryLines.push(`  ${pc.dim('copy →')} ${formatList(agentNames)}`);
  }

  const overwriteAgents = targetAgents
    .filter((a) => overwriteStatus.get(a))
    .map((a) => agents[a].displayName);

  if (overwriteAgents.length > 0) {
    summaryLines.push(`  ${pc.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Installation Summary');

  if (!options.yes) {
    const confirmed = await p.confirm({
      message: 'Proceed with installation?',
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }
  }

  spinner.start('Installing skill...');

  const results: {
    skill: string;
    agent: string;
    success: boolean;
    path: string;
    canonicalPath?: string;
    mode: InstallMode;
    symlinkFailed?: boolean;
    error?: string;
  }[] = [];

  for (const agent of targetAgents) {
    const result = await installRemoteSkillForAgent(remoteSkill, agent, {
      global: installGlobally,
      mode: installMode,
    });
    results.push({
      skill: remoteSkill.installName,
      agent: agents[agent].displayName,
      ...result,
    });
  }

  spinner.stop('Installation complete');

  console.log();
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // Track installation with provider-specific source identifier
  track({
    event: 'install',
    source: remoteSkill.sourceIdentifier,
    skills: remoteSkill.installName,
    agents: targetAgents.join(','),
    ...(installGlobally && { global: '1' }),
    skillFiles: JSON.stringify({ [remoteSkill.installName]: url }),
    sourceType: remoteSkill.providerId,
  });

  // Add to skill lock file for update tracking (only for global installs)
  if (successful.length > 0 && installGlobally) {
    try {
      // Try to fetch the folder hash from GitHub Trees API
      let skillFolderHash = '';
      if (remoteSkill.providerId === 'github') {
        const hash = await fetchSkillFolderHash(remoteSkill.sourceIdentifier, url);
        if (hash) skillFolderHash = hash;
      }

      await addSkillToLock(remoteSkill.installName, {
        source: remoteSkill.sourceIdentifier,
        sourceType: remoteSkill.providerId,
        sourceUrl: url,
        skillFolderHash,
      });
    } catch {
      // Don't fail installation if lock file update fails
    }
  }

  if (successful.length > 0) {
    const resultLines: string[] = [];
    const firstResult = successful[0]!;

    if (firstResult.mode === 'copy') {
      resultLines.push(`${pc.green('✓')} ${remoteSkill.installName} ${pc.dim('(copied)')}`);
      for (const r of successful) {
        const shortPath = shortenPath(r.path, cwd);
        resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
      }
    } else {
      // Symlink mode
      if (firstResult.canonicalPath) {
        const shortPath = shortenPath(firstResult.canonicalPath, cwd);
        resultLines.push(`${pc.green('✓')} ${shortPath}`);
      } else {
        resultLines.push(`${pc.green('✓')} ${remoteSkill.installName}`);
      }
      const symlinked = successful.filter((r) => !r.symlinkFailed).map((r) => r.agent);
      const copied = successful.filter((r) => r.symlinkFailed).map((r) => r.agent);

      if (symlinked.length > 0) {
        resultLines.push(`  ${pc.dim('symlink →')} ${formatList(symlinked)}`);
      }
      if (copied.length > 0) {
        resultLines.push(`  ${pc.yellow('copied →')} ${formatList(copied)}`);
      }
    }

    const title = pc.green(
      `Installed 1 skill to ${successful.length} agent${successful.length !== 1 ? 's' : ''}`
    );
    p.note(resultLines.join('\n'), title);

    // Show symlink failure warning
    const symlinkFailures = successful.filter((r) => r.mode === 'symlink' && r.symlinkFailed);
    if (symlinkFailures.length > 0) {
      const copiedAgentNames = symlinkFailures.map((r) => r.agent);
      p.log.warn(pc.yellow(`Symlinks failed for: ${formatList(copiedAgentNames)}`));
      p.log.message(
        pc.dim(
          '  Files were copied instead. On Windows, enable Developer Mode for symlink support.'
        )
      );
    }
  }

  if (failed.length > 0) {
    console.log();
    p.log.error(pc.red(`Failed to install ${failed.length}`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.agent}: ${pc.dim(r.error)}`);
    }
  }

  console.log();
  p.outro(pc.green('Done!'));

  // Prompt for find-skills after successful install
  await promptForFindSkills();
}

/**
 * Handle skills from a well-known endpoint (RFC 8615).
 * Discovers skills from /.well-known/skills/index.json
 */
async function handleWellKnownSkills(
  source: string,
  url: string,
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  spinner.start('Discovering skills from well-known endpoint...');

  // Fetch all skills from the well-known endpoint
  const skills = await wellKnownProvider.fetchAllSkills(url);

  if (skills.length === 0) {
    spinner.stop(pc.red('No skills found'));
    p.outro(
      pc.red(
        'No skills found at this URL. Make sure the server has a /.well-known/skills/index.json file.'
      )
    );
    process.exit(1);
  }

  spinner.stop(`Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);

  // Log discovered skills
  for (const skill of skills) {
    p.log.info(`Skill: ${pc.cyan(skill.installName)}`);
    p.log.message(pc.dim(skill.description));
    if (skill.files.size > 1) {
      p.log.message(pc.dim(`  Files: ${Array.from(skill.files.keys()).join(', ')}`));
    }
  }

  if (options.list) {
    console.log();
    p.log.step(pc.bold('Available Skills'));
    for (const skill of skills) {
      p.log.message(`  ${pc.cyan(skill.installName)}`);
      p.log.message(`    ${pc.dim(skill.description)}`);
      if (skill.files.size > 1) {
        p.log.message(`    ${pc.dim(`Files: ${skill.files.size}`)}`);
      }
    }
    console.log();
    p.outro('Run without --list to install');
    process.exit(0);
  }

  // Filter skills if --skill option is provided
  let selectedSkills: WellKnownSkill[];

  if (options.skill && options.skill.length > 0) {
    selectedSkills = skills.filter((s) =>
      options.skill!.some(
        (name) =>
          s.installName.toLowerCase() === name.toLowerCase() ||
          s.name.toLowerCase() === name.toLowerCase()
      )
    );

    if (selectedSkills.length === 0) {
      p.log.error(`No matching skills found for: ${options.skill.join(', ')}`);
      p.log.info('Available skills:');
      for (const s of skills) {
        p.log.message(`  - ${s.installName}`);
      }
      process.exit(1);
    }

    p.log.info(
      `Selected ${selectedSkills.length} skill${selectedSkills.length !== 1 ? 's' : ''}: ${selectedSkills.map((s) => pc.cyan(s.installName)).join(', ')}`
    );
  } else if (skills.length === 1) {
    selectedSkills = skills;
    const firstSkill = skills[0]!;
    p.log.info(`Skill: ${pc.cyan(firstSkill.installName)}`);
  } else if (options.yes) {
    selectedSkills = skills;
    p.log.info(`Installing all ${skills.length} skills`);
  } else {
    // Prompt user to select skills
    const skillChoices = skills.map((s) => ({
      value: s,
      label: s.installName,
      hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
    }));

    const selected = await multiselect({
      message: 'Select skills to install',
      options: skillChoices,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }

    selectedSkills = selected as WellKnownSkill[];
  }

  // Detect agents
  let targetAgents: AgentType[];
  const validAgents = Object.keys(agents);

  if (options.agent && options.agent.length > 0) {
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }

    targetAgents = options.agent as AgentType[];
  } else if (options.all) {
    targetAgents = validAgents as AgentType[];
    p.log.info(`Installing to all ${targetAgents.length} agents`);
  } else {
    spinner.start('Detecting installed agents...');
    const installedAgents = await detectInstalledAgents();
    spinner.stop(
      `Detected ${installedAgents.length} agent${installedAgents.length !== 1 ? 's' : ''}`
    );

    if (installedAgents.length === 0) {
      if (options.yes) {
        targetAgents = validAgents as AgentType[];
        p.log.info('Installing to all agents (none detected)');
      } else {
        p.log.warn('No coding agents detected. You can still install skills.');

        const allAgentChoices = Object.entries(agents).map(([key, config]) => ({
          value: key as AgentType,
          label: config.displayName,
        }));

        // Use helper to prompt with memory (defaulting to all)
        const selected = await promptForAgents(
          'Select agents to install skills to',
          allAgentChoices,
          true
        );

        if (p.isCancel(selected)) {
          p.cancel('Installation cancelled');
          process.exit(0);
        }

        targetAgents = selected as AgentType[];
      }
    } else if (installedAgents.length === 1 || options.yes) {
      targetAgents = installedAgents;
      if (installedAgents.length === 1) {
        const firstAgent = installedAgents[0]!;
        p.log.info(`Installing to: ${pc.cyan(agents[firstAgent].displayName)}`);
      } else {
        p.log.info(
          `Installing to: ${installedAgents.map((a) => pc.cyan(agents[a].displayName)).join(', ')}`
        );
      }
    } else {
      const selected = await selectAgentsInteractive(installedAgents, { global: options.global });

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        process.exit(0);
      }

      targetAgents = selected as AgentType[];
    }
  }

  let installGlobally = options.global ?? false;

  if (options.global === undefined && !options.yes) {
    const scope = await p.select({
      message: 'Installation scope',
      options: [
        {
          value: false,
          label: 'Project',
          hint: 'Install in current directory (committed with your project)',
        },
        {
          value: true,
          label: 'Global',
          hint: 'Install in home directory (available across all projects)',
        },
      ],
    });

    if (p.isCancel(scope)) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }

    installGlobally = scope as boolean;
  }

  // Prompt for install mode (symlink vs copy)
  let installMode: InstallMode = 'symlink';

  if (!options.yes) {
    const modeChoice = await p.select({
      message: 'Installation method',
      options: [
        {
          value: 'symlink',
          label: 'Symlink (Recommended)',
          hint: 'Single source of truth, easy updates',
        },
        { value: 'copy', label: 'Copy to all agents', hint: 'Independent copies for each agent' },
      ],
    });

    if (p.isCancel(modeChoice)) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }

    installMode = modeChoice as InstallMode;
  }

  const cwd = process.cwd();

  // Build installation summary
  const summaryLines: string[] = [];
  const agentNames = targetAgents.map((a) => agents[a].displayName);

  // Check if any skill will be overwritten
  const overwriteStatus = new Map<string, Map<string, boolean>>();
  for (const skill of selectedSkills) {
    const agentStatus = new Map<string, boolean>();
    for (const agent of targetAgents) {
      agentStatus.set(
        agent,
        await isSkillInstalled(skill.installName, agent, { global: installGlobally })
      );
    }
    overwriteStatus.set(skill.installName, agentStatus);
  }

  for (const skill of selectedSkills) {
    if (summaryLines.length > 0) summaryLines.push('');

    if (installMode === 'symlink') {
      const canonicalPath = getCanonicalPath(skill.installName, { global: installGlobally });
      const shortCanonical = shortenPath(canonicalPath, cwd);
      summaryLines.push(`${pc.cyan(shortCanonical)}`);
      summaryLines.push(`  ${pc.dim('symlink →')} ${formatList(agentNames)}`);
      if (skill.files.size > 1) {
        summaryLines.push(`  ${pc.dim('files:')} ${skill.files.size}`);
      }
    } else {
      summaryLines.push(`${pc.cyan(skill.installName)}`);
      summaryLines.push(`  ${pc.dim('copy →')} ${formatList(agentNames)}`);
    }

    const skillOverwrites = overwriteStatus.get(skill.installName);
    const overwriteAgents = targetAgents
      .filter((a) => skillOverwrites?.get(a))
      .map((a) => agents[a].displayName);

    if (overwriteAgents.length > 0) {
      summaryLines.push(`  ${pc.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
    }
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Installation Summary');

  if (!options.yes) {
    const confirmed = await p.confirm({ message: 'Proceed with installation?' });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }
  }

  spinner.start('Installing skills...');

  const results: {
    skill: string;
    agent: string;
    success: boolean;
    path: string;
    canonicalPath?: string;
    mode: InstallMode;
    symlinkFailed?: boolean;
    error?: string;
  }[] = [];

  for (const skill of selectedSkills) {
    for (const agent of targetAgents) {
      const result = await installWellKnownSkillForAgent(skill, agent, {
        global: installGlobally,
        mode: installMode,
      });
      results.push({
        skill: skill.installName,
        agent: agents[agent].displayName,
        ...result,
      });
    }
  }

  spinner.stop('Installation complete');

  console.log();
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // Track installation
  const sourceIdentifier = wellKnownProvider.getSourceIdentifier(url);
  track({
    event: 'install',
    source: sourceIdentifier,
    skills: selectedSkills.map((s) => s.installName).join(','),
    agents: targetAgents.join(','),
    ...(installGlobally && { global: '1' }),
    sourceType: 'well-known',
  });

  // Add to skill lock file for update tracking (only for global installs)
  if (successful.length > 0 && installGlobally) {
    const successfulSkillNames = new Set(successful.map((r) => r.skill));
    for (const skill of selectedSkills) {
      if (successfulSkillNames.has(skill.installName)) {
        try {
          await addSkillToLock(skill.installName, {
            source: sourceIdentifier,
            sourceType: 'well-known',
            sourceUrl: skill.sourceUrl,
            skillFolderHash: '', // Well-known skills don't have a folder hash
          });
        } catch {
          // Don't fail installation if lock file update fails
        }
      }
    }
  }

  if (successful.length > 0) {
    const bySkill = new Map<string, typeof results>();
    for (const r of successful) {
      const skillResults = bySkill.get(r.skill) || [];
      skillResults.push(r);
      bySkill.set(r.skill, skillResults);
    }

    const skillCount = bySkill.size;
    const agentCount = new Set(successful.map((r) => r.agent)).size;
    const symlinkFailures = successful.filter((r) => r.mode === 'symlink' && r.symlinkFailed);
    const copiedAgents = symlinkFailures.map((r) => r.agent);
    const resultLines: string[] = [];

    for (const [skillName, skillResults] of bySkill) {
      const firstResult = skillResults[0]!;

      if (firstResult.mode === 'copy') {
        // Copy mode: show skill name and list all agent paths
        resultLines.push(`${pc.green('✓')} ${skillName} ${pc.dim('(copied)')}`);
        for (const r of skillResults) {
          const shortPath = shortenPath(r.path, cwd);
          resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
        }
      } else {
        // Symlink mode: show canonical path and symlinked agents
        if (firstResult.canonicalPath) {
          const shortPath = shortenPath(firstResult.canonicalPath, cwd);
          resultLines.push(`${pc.green('✓')} ${shortPath}`);
        } else {
          resultLines.push(`${pc.green('✓')} ${skillName}`);
        }
        const symlinked = skillResults.filter((r) => !r.symlinkFailed).map((r) => r.agent);
        const copied = skillResults.filter((r) => r.symlinkFailed).map((r) => r.agent);

        if (symlinked.length > 0) {
          resultLines.push(`  ${pc.dim('symlink →')} ${formatList(symlinked)}`);
        }
        if (copied.length > 0) {
          resultLines.push(`  ${pc.yellow('copied →')} ${formatList(copied)}`);
        }
      }
    }

    const title = pc.green(
      `Installed ${skillCount} skill${skillCount !== 1 ? 's' : ''} to ${agentCount} agent${agentCount !== 1 ? 's' : ''}`
    );
    p.note(resultLines.join('\n'), title);

    // Show symlink failure warning (only for symlink mode)
    if (symlinkFailures.length > 0) {
      p.log.warn(pc.yellow(`Symlinks failed for: ${formatList(copiedAgents)}`));
      p.log.message(
        pc.dim(
          '  Files were copied instead. On Windows, enable Developer Mode for symlink support.'
        )
      );
    }
  }

  if (failed.length > 0) {
    console.log();
    p.log.error(pc.red(`Failed to install ${failed.length}`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.agent}: ${pc.dim(r.error)}`);
    }
  }

  console.log();
  p.outro(pc.green('Done!'));

  // Prompt for find-skills after successful install
  await promptForFindSkills();
}

/**
 * Legacy handler for direct URL skill installation (Mintlify-hosted skills)
 * @deprecated Use handleRemoteSkill with provider system instead
 */
async function handleDirectUrlSkillLegacy(
  source: string,
  url: string,
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  spinner.start('Fetching skill.md...');
  const mintlifySkill = await fetchMintlifySkill(url);

  if (!mintlifySkill) {
    spinner.stop(pc.red('Invalid skill'));
    p.outro(
      pc.red(
        'Could not fetch skill.md or missing required frontmatter (name, description, mintlify-proj).'
      )
    );
    process.exit(1);
  }

  // Convert to RemoteSkill and use the new handler
  const remoteSkill: RemoteSkill = {
    name: mintlifySkill.name,
    description: mintlifySkill.description,
    content: mintlifySkill.content,
    installName: mintlifySkill.mintlifySite,
    sourceUrl: mintlifySkill.sourceUrl,
    providerId: 'mintlify',
    sourceIdentifier: 'mintlify/com',
  };

  spinner.stop(`Found skill: ${pc.cyan(remoteSkill.installName)}`);

  p.log.info(`Skill: ${pc.cyan(remoteSkill.name)}`);
  p.log.message(pc.dim(remoteSkill.description));

  if (options.list) {
    console.log();
    p.log.step(pc.bold('Skill Details'));
    p.log.message(`  ${pc.cyan('Name:')} ${remoteSkill.name}`);
    p.log.message(`  ${pc.cyan('Site:')} ${remoteSkill.installName}`);
    p.log.message(`  ${pc.cyan('Description:')} ${remoteSkill.description}`);
    console.log();
    p.outro('Run without --list to install');
    process.exit(0);
  }

  // Detect agents
  let targetAgents: AgentType[];
  const validAgents = Object.keys(agents);

  if (options.agent && options.agent.length > 0) {
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }

    targetAgents = options.agent as AgentType[];
  } else {
    spinner.start('Detecting installed agents...');
    const installedAgents = await detectInstalledAgents();
    spinner.stop(
      `Detected ${installedAgents.length} agent${installedAgents.length !== 1 ? 's' : ''}`
    );

    if (installedAgents.length === 0) {
      if (options.yes) {
        targetAgents = validAgents as AgentType[];
        p.log.info('Installing to all agents (none detected)');
      } else {
        p.log.warn('No coding agents detected. You can still install skills.');

        const allAgentChoices = Object.entries(agents).map(([key, config]) => ({
          value: key as AgentType,
          label: config.displayName,
        }));

        // Use helper to prompt with memory (defaulting to all)
        const selected = await promptForAgents(
          'Select agents to install skills to',
          allAgentChoices,
          true
        );

        if (p.isCancel(selected)) {
          p.cancel('Installation cancelled');
          process.exit(0);
        }

        targetAgents = selected as AgentType[];
      }
    } else if (installedAgents.length === 1 || options.yes) {
      targetAgents = installedAgents;
      if (installedAgents.length === 1) {
        const firstAgent = installedAgents[0]!;
        p.log.info(`Installing to: ${pc.cyan(agents[firstAgent].displayName)}`);
      } else {
        p.log.info(
          `Installing to: ${installedAgents.map((a) => pc.cyan(agents[a].displayName)).join(', ')}`
        );
      }
    } else {
      const selected = await selectAgentsInteractive(installedAgents, { global: options.global });

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        process.exit(0);
      }

      targetAgents = selected as AgentType[];
    }
  }

  let installGlobally = options.global ?? false;

  if (options.global === undefined && !options.yes) {
    const scope = await p.select({
      message: 'Installation scope',
      options: [
        {
          value: false,
          label: 'Project',
          hint: 'Install in current directory (committed with your project)',
        },
        {
          value: true,
          label: 'Global',
          hint: 'Install in home directory (available across all projects)',
        },
      ],
    });

    if (p.isCancel(scope)) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }

    installGlobally = scope as boolean;
  }

  // Use symlink mode by default for direct URL skills
  const installMode: InstallMode = 'symlink';
  const cwd = process.cwd();

  // Check for overwrites
  const overwriteStatus = new Map<string, boolean>();
  for (const agent of targetAgents) {
    overwriteStatus.set(
      agent,
      await isSkillInstalled(remoteSkill.installName, agent, {
        global: installGlobally,
      })
    );
  }

  // Build installation summary
  const summaryLines: string[] = [];
  const agentNames = targetAgents.map((a) => agents[a].displayName);
  const canonicalPath = getCanonicalPath(remoteSkill.installName, { global: installGlobally });
  const shortCanonical = shortenPath(canonicalPath, cwd);
  summaryLines.push(`${pc.cyan(shortCanonical)}`);
  summaryLines.push(`  ${pc.dim('symlink →')} ${formatList(agentNames)}`);

  const overwriteAgents = targetAgents
    .filter((a) => overwriteStatus.get(a))
    .map((a) => agents[a].displayName);

  if (overwriteAgents.length > 0) {
    summaryLines.push(`  ${pc.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Installation Summary');

  if (!options.yes) {
    const confirmed = await p.confirm({
      message: 'Proceed with installation?',
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }
  }

  spinner.start('Installing skill...');

  const results: {
    skill: string;
    agent: string;
    success: boolean;
    path: string;
    canonicalPath?: string;
    mode: InstallMode;
    symlinkFailed?: boolean;
    error?: string;
  }[] = [];

  for (const agent of targetAgents) {
    const result = await installRemoteSkillForAgent(remoteSkill, agent, {
      global: installGlobally,
      mode: installMode,
    });
    results.push({
      skill: remoteSkill.installName,
      agent: agents[agent].displayName,
      ...result,
    });
  }

  spinner.stop('Installation complete');

  console.log();
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // Track installation
  track({
    event: 'install',
    source: 'mintlify/com',
    skills: remoteSkill.installName,
    agents: targetAgents.join(','),
    ...(installGlobally && { global: '1' }),
    skillFiles: JSON.stringify({ [remoteSkill.installName]: url }),
    sourceType: 'mintlify',
  });

  // Add to skill lock file for update tracking (only for global installs)
  if (successful.length > 0 && installGlobally) {
    try {
      // skillFolderHash will be populated by telemetry server
      // Mintlify skills are single-file, so folder hash = content hash on server
      await addSkillToLock(remoteSkill.installName, {
        source: `mintlify/${remoteSkill.installName}`,
        sourceType: 'mintlify',
        sourceUrl: url,
        skillFolderHash: '', // Populated by server
      });
    } catch {
      // Don't fail installation if lock file update fails
    }
  }

  if (successful.length > 0) {
    const resultLines: string[] = [];
    const firstResult = successful[0]!;

    if (firstResult.canonicalPath) {
      const shortPath = shortenPath(firstResult.canonicalPath, cwd);
      resultLines.push(`${pc.green('✓')} ${shortPath}`);
    } else {
      resultLines.push(`${pc.green('✓')} ${remoteSkill.installName}`);
    }
    const symlinked = successful.filter((r) => !r.symlinkFailed).map((r) => r.agent);
    const copied = successful.filter((r) => r.symlinkFailed).map((r) => r.agent);

    if (symlinked.length > 0) {
      resultLines.push(`  ${pc.dim('symlink →')} ${formatList(symlinked)}`);
    }
    if (copied.length > 0) {
      resultLines.push(`  ${pc.yellow('copied →')} ${formatList(copied)}`);
    }

    const title = pc.green(
      `Installed 1 skill to ${successful.length} agent${successful.length !== 1 ? 's' : ''}`
    );
    p.note(resultLines.join('\n'), title);

    // Show symlink failure warning
    const symlinkFailures = successful.filter((r) => r.mode === 'symlink' && r.symlinkFailed);
    if (symlinkFailures.length > 0) {
      const copiedAgentNames = symlinkFailures.map((r) => r.agent);
      p.log.warn(pc.yellow(`Symlinks failed for: ${formatList(copiedAgentNames)}`));
      p.log.message(
        pc.dim(
          '  Files were copied instead. On Windows, enable Developer Mode for symlink support.'
        )
      );
    }
  }

  if (failed.length > 0) {
    console.log();
    p.log.error(pc.red(`Failed to install ${failed.length}`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.agent}: ${pc.dim(r.error)}`);
    }
  }

  console.log();
  p.outro(pc.green('Done!'));

  // Prompt for find-skills after successful install
  await promptForFindSkills();
}

export async function runAdd(args: string[], options: AddOptions = {}): Promise<void> {
  const source = args[0];
  let installTipShown = false;

  const showInstallTip = (): void => {
    if (installTipShown) return;
    p.log.message(
      pc.dim('Tip: use the --yes (-y) and --global (-g) flags to install without prompts.')
    );
    installTipShown = true;
  };

  if (!source) {
    console.log();
    console.log(
      pc.bgRed(pc.white(pc.bold(' ERROR '))) + ' ' + pc.red('Missing required argument: source')
    );
    console.log();
    console.log(pc.dim('  Usage:'));
    console.log(`    ${pc.cyan('npx skills add')} ${pc.yellow('<source>')} ${pc.dim('[options]')}`);
    console.log();
    console.log(pc.dim('  Example:'));
    console.log(`    ${pc.cyan('npx skills add')} ${pc.yellow('vercel-labs/agent-skills')}`);
    console.log();
    process.exit(1);
  }

  // --all implies -y (skip prompts and select all)
  if (options.all) {
    options.yes = true;
  }

  console.log();
  p.intro(pc.bgCyan(pc.black(' skills ')));

  if (!process.stdin.isTTY) {
    showInstallTip();
  }

  let tempDir: string | null = null;

  try {
    const spinner = p.spinner();

    spinner.start('Parsing source...');
    const parsed = parseSource(source);
    spinner.stop(
      `Source: ${parsed.type === 'local' ? parsed.localPath! : parsed.url}${parsed.ref ? ` @ ${pc.yellow(parsed.ref)}` : ''}${parsed.subpath ? ` (${parsed.subpath})` : ''}`
    );

    // Handle direct URL skills (Mintlify, HuggingFace, etc.) via provider system
    if (parsed.type === 'direct-url') {
      await handleRemoteSkill(source, parsed.url, options, spinner);
      return;
    }

    // Handle well-known skills from arbitrary URLs
    if (parsed.type === 'well-known') {
      await handleWellKnownSkills(source, parsed.url, options, spinner);
      return;
    }

    let skillsDir: string;

    if (parsed.type === 'local') {
      // Use local path directly, no cloning needed
      spinner.start('Validating local path...');
      if (!existsSync(parsed.localPath!)) {
        spinner.stop(pc.red('Path not found'));
        p.outro(pc.red(`Local path does not exist: ${parsed.localPath}`));
        process.exit(1);
      }
      skillsDir = parsed.localPath!;
      spinner.stop('Local path validated');
    } else {
      // Clone repository for remote sources
      spinner.start('Cloning repository...');
      tempDir = await cloneRepo(parsed.url, parsed.ref);
      skillsDir = tempDir;
      spinner.stop('Repository cloned');
    }

    spinner.start('Discovering skills...');
    const skills = await discoverSkills(skillsDir, parsed.subpath);

    if (skills.length === 0) {
      spinner.stop(pc.red('No skills found'));
      p.outro(
        pc.red('No valid skills found. Skills require a SKILL.md with name and description.')
      );
      await cleanup(tempDir);
      process.exit(1);
    }

    spinner.stop(
      `Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''} ${pc.dim('(via Well-known Agent Skill Discovery)')}`
    );

    if (options.list) {
      console.log();
      p.log.step(pc.bold('Available Skills'));
      for (const skill of skills) {
        p.log.message(`  ${pc.cyan(getSkillDisplayName(skill))}`);
        p.log.message(`    ${pc.dim(skill.description)}`);
      }
      console.log();
      p.outro('Use --skill <name> to install specific skills');
      await cleanup(tempDir);
      process.exit(0);
    }

    let selectedSkills: Skill[];

    if (options.skill && options.skill.length > 0) {
      selectedSkills = skills.filter((s) =>
        options.skill!.some(
          (name) =>
            s.name.toLowerCase() === name.toLowerCase() ||
            getSkillDisplayName(s).toLowerCase() === name.toLowerCase()
        )
      );

      if (selectedSkills.length === 0) {
        p.log.error(`No matching skills found for: ${options.skill.join(', ')}`);
        p.log.info('Available skills:');
        for (const s of skills) {
          p.log.message(`  - ${getSkillDisplayName(s)}`);
        }
        await cleanup(tempDir);
        process.exit(1);
      }

      p.log.info(
        `Selected ${selectedSkills.length} skill${selectedSkills.length !== 1 ? 's' : ''}: ${selectedSkills.map((s) => pc.cyan(getSkillDisplayName(s))).join(', ')}`
      );
    } else if (skills.length === 1) {
      selectedSkills = skills;
      const firstSkill = skills[0]!;
      p.log.info(`Skill: ${pc.cyan(getSkillDisplayName(firstSkill))}`);
      p.log.message(pc.dim(firstSkill.description));
    } else if (options.yes) {
      selectedSkills = skills;
      p.log.info(`Installing all ${skills.length} skills`);
    } else {
      const skillChoices = skills.map((s) => ({
        value: s,
        label: getSkillDisplayName(s),
        hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
      }));

      const selected = await multiselect({
        message: 'Select skills to install',
        options: skillChoices,
        required: true,
      });

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      selectedSkills = selected as Skill[];
    }

    let targetAgents: AgentType[];
    const validAgents = Object.keys(agents);

    if (options.agent && options.agent.length > 0) {
      const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

      if (invalidAgents.length > 0) {
        p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
        p.log.info(`Valid agents: ${validAgents.join(', ')}`);
        await cleanup(tempDir);
        process.exit(1);
      }

      targetAgents = options.agent as AgentType[];
    } else if (options.all) {
      // --all flag: install to all agents without detection
      targetAgents = validAgents as AgentType[];
      p.log.info(`Installing to all ${targetAgents.length} agents`);
    } else {
      spinner.start('Detecting installed agents...');
      const installedAgents = await detectInstalledAgents();
      spinner.stop(
        `Detected ${installedAgents.length} agent${installedAgents.length !== 1 ? 's' : ''}`
      );

      if (installedAgents.length === 0) {
        if (options.yes) {
          targetAgents = validAgents as AgentType[];
          p.log.info('Installing to all agents (none detected)');
        } else {
          p.log.warn('No coding agents detected. You can still install skills.');

          const allAgentChoices = Object.entries(agents).map(([key, config]) => ({
            value: key as AgentType,
            label: config.displayName,
          }));

          // Use helper to prompt with memory (defaulting to all)
          const selected = await promptForAgents(
            'Select agents to install skills to',
            allAgentChoices,
            true
          );

          if (p.isCancel(selected)) {
            p.cancel('Installation cancelled');
            await cleanup(tempDir);
            process.exit(0);
          }

          targetAgents = selected as AgentType[];
        }
      } else if (installedAgents.length === 1 || options.yes) {
        targetAgents = installedAgents;
        if (installedAgents.length === 1) {
          const firstAgent = installedAgents[0]!;
          p.log.info(`Installing to: ${pc.cyan(agents[firstAgent].displayName)}`);
        } else {
          p.log.info(
            `Installing to: ${installedAgents.map((a) => pc.cyan(agents[a].displayName)).join(', ')}`
          );
        }
      } else {
        const selected = await selectAgentsInteractive(installedAgents, { global: options.global });

        if (p.isCancel(selected)) {
          p.cancel('Installation cancelled');
          await cleanup(tempDir);
          process.exit(0);
        }

        targetAgents = selected as AgentType[];
      }
    }

    let installGlobally = options.global ?? false;

    if (options.global === undefined && !options.yes) {
      const scope = await p.select({
        message: 'Installation scope',
        options: [
          {
            value: false,
            label: 'Project',
            hint: 'Install in current directory (committed with your project)',
          },
          {
            value: true,
            label: 'Global',
            hint: 'Install in home directory (available across all projects)',
          },
        ],
      });

      if (p.isCancel(scope)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      installGlobally = scope as boolean;
    }

    // Prompt for install mode (symlink vs copy)
    let installMode: InstallMode = 'symlink';

    if (!options.yes) {
      const modeChoice = await p.select({
        message: 'Installation method',
        options: [
          {
            value: 'symlink',
            label: 'Symlink (Recommended)',
            hint: 'Single source of truth, easy updates',
          },
          { value: 'copy', label: 'Copy to all agents', hint: 'Independent copies for each agent' },
        ],
      });

      if (p.isCancel(modeChoice)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      installMode = modeChoice as InstallMode;
    }

    const cwd = process.cwd();

    // Build installation summary
    const summaryLines: string[] = [];
    const agentNames = targetAgents.map((a) => agents[a].displayName);

    // Check if any skill will be overwritten
    const overwriteStatus = new Map<string, Map<string, boolean>>();
    for (const skill of selectedSkills) {
      const agentStatus = new Map<string, boolean>();
      for (const agent of targetAgents) {
        agentStatus.set(
          agent,
          await isSkillInstalled(skill.name, agent, { global: installGlobally })
        );
      }
      overwriteStatus.set(skill.name, agentStatus);
    }

    for (const skill of selectedSkills) {
      if (summaryLines.length > 0) summaryLines.push('');

      if (installMode === 'symlink') {
        const canonicalPath = getCanonicalPath(skill.name, { global: installGlobally });
        const shortCanonical = shortenPath(canonicalPath, cwd);
        summaryLines.push(`${pc.cyan(shortCanonical)}`);
        summaryLines.push(`  ${pc.dim('symlink →')} ${formatList(agentNames)}`);
      } else {
        summaryLines.push(`${pc.cyan(getSkillDisplayName(skill))}`);
        summaryLines.push(`  ${pc.dim('copy →')} ${formatList(agentNames)}`);
      }

      const skillOverwrites = overwriteStatus.get(skill.name);
      const overwriteAgents = targetAgents
        .filter((a) => skillOverwrites?.get(a))
        .map((a) => agents[a].displayName);

      if (overwriteAgents.length > 0) {
        summaryLines.push(`  ${pc.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
      }
    }

    console.log();
    p.note(summaryLines.join('\n'), 'Installation Summary');

    if (!options.yes) {
      const confirmed = await p.confirm({ message: 'Proceed with installation?' });

      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }
    }

    spinner.start('Installing skills...');

    const results: {
      skill: string;
      agent: string;
      success: boolean;
      path: string;
      canonicalPath?: string;
      mode: InstallMode;
      symlinkFailed?: boolean;
      error?: string;
    }[] = [];

    for (const skill of selectedSkills) {
      for (const agent of targetAgents) {
        const result = await installSkillForAgent(skill, agent, {
          global: installGlobally,
          mode: installMode,
        });
        results.push({
          skill: getSkillDisplayName(skill),
          agent: agents[agent].displayName,
          ...result,
        });
      }
    }

    spinner.stop('Installation complete');

    console.log();
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Track installation result
    // Build skillFiles map: { skillName: relative path to SKILL.md from repo root }
    const skillFiles: Record<string, string> = {};
    for (const skill of selectedSkills) {
      // skill.path is absolute, compute relative from tempDir (repo root)
      let relativePath: string;
      if (tempDir && skill.path === tempDir) {
        // Skill is at root level of repo
        relativePath = 'SKILL.md';
      } else if (tempDir && skill.path.startsWith(tempDir + '/')) {
        // Compute path relative to repo root (tempDir), not search path
        relativePath = skill.path.slice(tempDir.length + 1) + '/SKILL.md';
      } else {
        // Local path - skip telemetry for local installs
        continue;
      }
      skillFiles[skill.name] = relativePath;
    }

    // Normalize source to owner/repo format for telemetry
    const normalizedSource = getOwnerRepo(parsed);

    // Only track if we have a valid remote source
    if (normalizedSource) {
      track({
        event: 'install',
        source: normalizedSource,
        skills: selectedSkills.map((s) => s.name).join(','),
        agents: targetAgents.join(','),
        ...(installGlobally && { global: '1' }),
        skillFiles: JSON.stringify(skillFiles),
      });
    }

    // Add to skill lock file for update tracking (only for global installs)
    if (successful.length > 0 && installGlobally && normalizedSource) {
      const successfulSkillNames = new Set(successful.map((r) => r.skill));
      for (const skill of selectedSkills) {
        const skillDisplayName = getSkillDisplayName(skill);
        if (successfulSkillNames.has(skillDisplayName)) {
          try {
            // Fetch the folder hash from GitHub Trees API
            let skillFolderHash = '';
            const skillPathValue = skillFiles[skill.name];
            if (parsed.type === 'github' && skillPathValue) {
              const hash = await fetchSkillFolderHash(normalizedSource, skillPathValue);
              if (hash) skillFolderHash = hash;
            }

            await addSkillToLock(skill.name, {
              source: normalizedSource,
              sourceType: parsed.type,
              sourceUrl: parsed.url,
              skillPath: skillPathValue,
              skillFolderHash,
            });
          } catch {
            // Don't fail installation if lock file update fails
          }
        }
      }
    }

    if (successful.length > 0) {
      const bySkill = new Map<string, typeof results>();
      for (const r of successful) {
        const skillResults = bySkill.get(r.skill) || [];
        skillResults.push(r);
        bySkill.set(r.skill, skillResults);
      }

      const skillCount = bySkill.size;
      const agentCount = new Set(successful.map((r) => r.agent)).size;
      const symlinkFailures = successful.filter((r) => r.mode === 'symlink' && r.symlinkFailed);
      const copiedAgents = symlinkFailures.map((r) => r.agent);
      const resultLines: string[] = [];

      for (const [skillName, skillResults] of bySkill) {
        const firstResult = skillResults[0]!;

        if (firstResult.mode === 'copy') {
          // Copy mode: show skill name and list all agent paths
          resultLines.push(`${pc.green('✓')} ${skillName} ${pc.dim('(copied)')}`);
          for (const r of skillResults) {
            const shortPath = shortenPath(r.path, cwd);
            resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
          }
        } else {
          // Symlink mode: show canonical path and symlinked agents
          if (firstResult.canonicalPath) {
            const shortPath = shortenPath(firstResult.canonicalPath, cwd);
            resultLines.push(`${pc.green('✓')} ${shortPath}`);
          } else {
            resultLines.push(`${pc.green('✓')} ${skillName}`);
          }
          const symlinked = skillResults.filter((r) => !r.symlinkFailed).map((r) => r.agent);
          const copied = skillResults.filter((r) => r.symlinkFailed).map((r) => r.agent);

          if (symlinked.length > 0) {
            resultLines.push(`  ${pc.dim('symlink →')} ${formatList(symlinked)}`);
          }
          if (copied.length > 0) {
            resultLines.push(`  ${pc.yellow('copied →')} ${formatList(copied)}`);
          }
        }
      }

      const title = pc.green(
        `Installed ${skillCount} skill${skillCount !== 1 ? 's' : ''} to ${agentCount} agent${agentCount !== 1 ? 's' : ''}`
      );
      p.note(resultLines.join('\n'), title);

      // Show symlink failure warning (only for symlink mode)
      if (symlinkFailures.length > 0) {
        p.log.warn(pc.yellow(`Symlinks failed for: ${formatList(copiedAgents)}`));
        p.log.message(
          pc.dim(
            '  Files were copied instead. On Windows, enable Developer Mode for symlink support.'
          )
        );
      }
    }

    if (failed.length > 0) {
      console.log();
      p.log.error(pc.red(`Failed to install ${failed.length}`));
      for (const r of failed) {
        p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.agent}: ${pc.dim(r.error)}`);
      }
    }

    console.log();
    p.outro(pc.green('Done!'));

    // Prompt for find-skills after successful install
    await promptForFindSkills();
  } catch (error) {
    if (error instanceof GitCloneError) {
      p.log.error(pc.red('Failed to clone repository'));
      // Print each line of the error message separately for better formatting
      for (const line of error.message.split('\n')) {
        p.log.message(pc.dim(line));
      }
    } else {
      p.log.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
    showInstallTip();
    p.outro(pc.red('Installation failed'));
    process.exit(1);
  } finally {
    await cleanup(tempDir);
  }
}

async function cleanup(tempDir: string | null) {
  if (tempDir) {
    try {
      await cleanupTempDir(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Prompt user to install the find-skills skill after their first installation.
 * This helps users discover skills via their coding agent.
 * The prompt is only shown once - if dismissed, it's stored in the lock file.
 */
async function promptForFindSkills(): Promise<void> {
  // Skip if already dismissed or not in interactive mode
  if (!process.stdin.isTTY) return;

  try {
    const dismissed = await isPromptDismissed('findSkillsPrompt');
    if (dismissed) return;

    // Check if find-skills is already installed
    const findSkillsInstalled = await isSkillInstalled('find-skills', 'claude-code', {
      global: true,
    });
    if (findSkillsInstalled) {
      // Mark as dismissed so we don't check again
      await dismissPrompt('findSkillsPrompt');
      return;
    }

    console.log();
    p.log.message(pc.dim("One-time prompt - you won't be asked again if you dismiss."));
    const install = await p.confirm({
      message: `Install the ${pc.cyan('find-skills')} skill? It helps your agent discover and suggest skills.`,
    });

    if (p.isCancel(install)) {
      await dismissPrompt('findSkillsPrompt');
      return;
    }

    if (install) {
      // Install find-skills globally to all agents
      // Mark as dismissed first to prevent recursive prompts
      await dismissPrompt('findSkillsPrompt');

      console.log();
      p.log.step('Installing find-skills skill...');

      try {
        // Call runAdd directly instead of spawning subprocess
        await runAdd(['vercel-labs/skills'], {
          skill: ['find-skills'],
          global: true,
          yes: true,
          all: true,
        });
      } catch {
        p.log.warn('Failed to install find-skills. You can try again with:');
        p.log.message(pc.dim('  npx skills add vercel-labs/skills@find-skills -g -y --all'));
      }
    } else {
      // User declined - dismiss the prompt
      await dismissPrompt('findSkillsPrompt');
      p.log.message(
        pc.dim('You can install it later with: npx skills add vercel-labs/skills@find-skills')
      );
    }
  } catch {
    // Don't fail the main installation if prompt fails
  }
}

// Parse command line options from args array
export function parseAddOptions(args: string[]): { source: string[]; options: AddOptions } {
  const options: AddOptions = {};
  const source: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '-l' || arg === '--list') {
      options.list = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.agent.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--; // Back up one since the loop will increment
    } else if (arg === '-s' || arg === '--skill') {
      options.skill = options.skill || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.skill.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--; // Back up one since the loop will increment
    } else if (arg && !arg.startsWith('-')) {
      source.push(arg);
    }
  }

  return { source, options };
}
