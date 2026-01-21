#!/usr/bin/env node

import { program } from 'commander';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { parseSource, getOwnerRepo } from './source-parser.js';
import { cloneRepo, cleanupTempDir } from './git.js';
import { discoverSkills, getSkillDisplayName } from './skills.js';
import { installSkillForAgent, isSkillInstalled, getCanonicalPath, getInstallPath } from './installer.js';
import { homedir } from 'os';

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
import { detectInstalledAgents, agents } from './agents.js';
import { track, setVersion } from './telemetry.js';
import type { Skill, AgentType } from './types.js';
import packageJson from '../package.json' with { type: 'json' };

const version = packageJson.version;
setVersion(version);

interface Options {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  skill?: string[];
  list?: boolean;
  all?: boolean;
}

program
  .name('add-skill')
  .description('Install skills onto coding agents (OpenCode, Claude Code, Cline, Codex, Kiro CLI, Cursor, Antigravity, Github Copilot, Roo Code)')
  .version(version)
  .argument('<source>', 'Git repo URL, GitHub shorthand (owner/repo), local path (./path), or direct path to skill')
  .option('-g, --global', 'Install skill globally (user-level) instead of project-level')
  .option('-a, --agent <agents...>', 'Specify agents to install to (opencode, claude-code, cline, codex, kiro-cli, cursor, antigravity, github-copilot, roo)')
  .option('-s, --skill <skills...>', 'Specify skill names to install (skip selection prompt)')
  .option('-l, --list', 'List available skills in the repository without installing')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--all', 'Install all skills to all agents without any prompts (implies -y -g)')
  .configureOutput({
    outputError: (str, write) => {
      if (str.includes('missing required argument')) {
        console.log();
        console.log(chalk.bgRed.white.bold(' ERROR ') + ' ' + chalk.red('Missing required argument: source'));
        console.log();
        console.log(chalk.dim('  Usage:'));
        console.log(`    ${chalk.cyan('npx add-skill')} ${chalk.yellow('<source>')} ${chalk.dim('[options]')}`);
        console.log();
        console.log(chalk.dim('  Example:'));
        console.log(`    ${chalk.cyan('npx add-skill')} ${chalk.yellow('vercel-labs/agent-skills')}`);
        console.log();
        console.log(chalk.dim('  Run') + ` ${chalk.cyan('npx add-skill --help')} ` + chalk.dim('for more information.'));
        console.log();
      } else {
        write(str);
      }
    }
  })
  .action(async (source: string, options: Options) => {
    await main(source, options);
  });

program.parse();

async function main(source: string, options: Options) {
    if (options.all) {
    options.yes = true;
    options.global = true;
  }

  console.log();
  p.intro(chalk.bgCyan.black(' skills '));

  let tempDir: string | null = null;

  try {
    const spinner = p.spinner();

    spinner.start('Parsing source...');
    const parsed = parseSource(source);
    spinner.stop(`Source: ${chalk.cyan(parsed.type === 'local' ? parsed.localPath! : parsed.url)}${parsed.ref ? ` @ ${chalk.yellow(parsed.ref)}` : ''}${parsed.subpath ? ` (${parsed.subpath})` : ''}`);

    let skillsDir: string;

    if (parsed.type === 'local') {
      spinner.start('Validating local path...');
      const { existsSync } = await import('fs');
      if (!existsSync(parsed.localPath!)) {
        spinner.stop(chalk.red('Path not found'));
        p.outro(chalk.red(`Local path does not exist: ${parsed.localPath}`));
        process.exit(1);
      }
      skillsDir = parsed.localPath!;
      spinner.stop('Local path validated');
    } else {
      spinner.start('Cloning repository...');
      tempDir = await cloneRepo(parsed.url, parsed.ref);
      skillsDir = tempDir;
      spinner.stop('Repository cloned');
    }

    spinner.start('Discovering skills...');
    const skills = await discoverSkills(skillsDir, parsed.subpath);

    if (skills.length === 0) {
      spinner.stop(chalk.red('No skills found'));
      p.outro(chalk.red('No valid skills found. Skills require a SKILL.md with name and description.'));
      await cleanup(tempDir);
      process.exit(1);
    }

    spinner.stop(`Found ${chalk.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);

    if (options.list) {
      console.log();
      p.log.step(chalk.bold('Available Skills'));
      for (const skill of skills) {
        p.log.message(`  ${chalk.cyan(getSkillDisplayName(skill))}`);
        p.log.message(`    ${chalk.dim(skill.description)}`);
      }
      console.log();
      p.outro('Use --skill <name> to install specific skills');
      await cleanup(tempDir);
      process.exit(0);
    }

    let selectedSkills: Skill[];

    if (options.skill && options.skill.length > 0) {
      selectedSkills = skills.filter(s =>
        options.skill!.some(name =>
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

      p.log.info(`Selected ${selectedSkills.length} skill${selectedSkills.length !== 1 ? 's' : ''}: ${selectedSkills.map(s => chalk.cyan(getSkillDisplayName(s))).join(', ')}`);
    } else if (skills.length === 1) {
      selectedSkills = skills;
      const firstSkill = skills[0]!;
      p.log.info(`Skill: ${chalk.cyan(getSkillDisplayName(firstSkill))}`);
      p.log.message(chalk.dim(firstSkill.description));
    } else if (options.yes) {
      selectedSkills = skills;
      p.log.info(`Installing all ${skills.length} skills`);
    } else {
      const skillChoices = skills.map(s => ({
        value: s,
        label: getSkillDisplayName(s),
        hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
      }));

      const selected = await p.multiselect({
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
      const invalidAgents = options.agent.filter(a => !validAgents.includes(a));

      if (invalidAgents.length > 0) {
        p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
        p.log.info(`Valid agents: ${validAgents.join(', ')}`);
        await cleanup(tempDir);
        process.exit(1);
      }

      targetAgents = options.agent as AgentType[];
    } else if (options.all) {
      targetAgents = validAgents as AgentType[];
      p.log.info(`Installing to all ${targetAgents.length} agents`);
    } else {
      spinner.start('Detecting installed agents...');
      const installedAgents = await detectInstalledAgents();
      spinner.stop(`Detected ${installedAgents.length} agent${installedAgents.length !== 1 ? 's' : ''}`);

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

          const selected = await p.multiselect({
            message: 'Select agents to install skills to',
            options: allAgentChoices,
            required: true,
            initialValues: Object.keys(agents) as AgentType[],
          });

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
          p.log.info(`Installing to: ${chalk.cyan(agents[firstAgent].displayName)}`);
        } else {
          p.log.info(`Installing to: ${installedAgents.map(a => chalk.cyan(agents[a].displayName)).join(', ')}`);
        }
      } else {
        const agentChoices = installedAgents.map(a => ({
          value: a,
          label: agents[a].displayName,
          hint: `${options.global ? agents[a].globalSkillsDir : agents[a].skillsDir}`,
        }));

        const selected = await p.multiselect({
          message: 'Select agents to install skills to',
          options: agentChoices,
          required: true,
          initialValues: installedAgents,
        });

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
          { value: false, label: 'Project', hint: 'Install in current directory (committed with your project)' },
          { value: true, label: 'Global', hint: 'Install in home directory (available across all projects)' },
        ],
      });

      if (p.isCancel(scope)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      installGlobally = scope as boolean;
    }

    const cwd = process.cwd();
    const summaryLines: string[] = [];
    const overwriteStatus = new Map<string, Map<string, boolean>>();
    for (const skill of selectedSkills) {
      const agentStatus = new Map<string, boolean>();
      for (const agent of targetAgents) {
        agentStatus.set(agent, await isSkillInstalled(skill.name, agent, { global: installGlobally }));
      }
      overwriteStatus.set(skill.name, agentStatus);
    }
    
    const agentNames = targetAgents.map(a => agents[a].displayName);
    const hasOverwrites = Array.from(overwriteStatus.values()).some(
      agentMap => Array.from(agentMap.values()).some(v => v)
    );
    
    for (const skill of selectedSkills) {
      if (summaryLines.length > 0) summaryLines.push('');
      
      const canonicalPath = getCanonicalPath(skill.name, { global: installGlobally });
      const shortCanonical = shortenPath(canonicalPath, cwd);
      summaryLines.push(`${chalk.cyan(shortCanonical)}`);
      
      const skillOverwrites = overwriteStatus.get(skill.name);
      const overwriteAgents = targetAgents
        .filter(a => skillOverwrites?.get(a))
        .map(a => agents[a].displayName);
      
      summaryLines.push(`  ${chalk.dim('→')} ${formatList(agentNames)}`);
      
      if (overwriteAgents.length > 0) {
        summaryLines.push(`  ${chalk.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
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

    const results: { skill: string; agent: string; success: boolean; path: string; canonicalPath?: string; symlinkFailed?: boolean; error?: string }[] = [];

    for (const skill of selectedSkills) {
      for (const agent of targetAgents) {
        const result = await installSkillForAgent(skill, agent, { global: installGlobally });
        results.push({
          skill: getSkillDisplayName(skill),
          agent: agents[agent].displayName,
          ...result,
        });
      }
    }

    spinner.stop('Installation complete');

    console.log();
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    const skillFiles: Record<string, string> = {};
    for (const skill of selectedSkills) {
      let relativePath: string;
      if (tempDir && skill.path === tempDir) {
        relativePath = 'SKILL.md';
      } else if (tempDir && skill.path.startsWith(tempDir + '/')) {
        relativePath = skill.path.slice(tempDir.length + 1) + '/SKILL.md';
      } else {
        continue;
      }
      skillFiles[skill.name] = relativePath;
    }

    const normalizedSource = getOwnerRepo(parsed);
    if (normalizedSource) {
      track({
        event: 'install',
        source: normalizedSource,
        skills: selectedSkills.map(s => s.name).join(','),
        agents: targetAgents.join(','),
        ...(installGlobally && { global: '1' }),
        skillFiles: JSON.stringify(skillFiles),
      });
    }

    if (successful.length > 0) {
      const bySkill = new Map<string, typeof results>();
      for (const r of successful) {
        const skillResults = bySkill.get(r.skill) || [];
        skillResults.push(r);
        bySkill.set(r.skill, skillResults);
      }
      
      const skillCount = bySkill.size;
      const agentCount = new Set(successful.map(r => r.agent)).size;
      const symlinkFailures = successful.filter(r => r.symlinkFailed);
      const copiedAgents = symlinkFailures.map(r => r.agent);
      const resultLines: string[] = [];
      
      for (const [, skillResults] of bySkill) {
        const firstResult = skillResults[0]!;
        if (firstResult.canonicalPath) {
          const shortPath = shortenPath(firstResult.canonicalPath, cwd);
          resultLines.push(`${chalk.green('✓')} ${shortPath}`);
        }
        const symlinked = skillResults.filter(r => !r.symlinkFailed).map(r => r.agent);
        const copied = skillResults.filter(r => r.symlinkFailed).map(r => r.agent);
        
        if (symlinked.length > 0) {
          resultLines.push(`  ${chalk.dim('→')} ${formatList(symlinked)}`);
        }
        if (copied.length > 0) {
          resultLines.push(`  ${chalk.yellow('copied →')} ${formatList(copied)}`);
        }
      }
      
      const title = chalk.green(`Installed ${skillCount} skill${skillCount !== 1 ? 's' : ''} to ${agentCount} agent${agentCount !== 1 ? 's' : ''}`);
      p.note(resultLines.join('\n'), title);
      
      // Show symlink failure warning
      if (symlinkFailures.length > 0) {
        p.log.warn(chalk.yellow(`Symlinks failed for: ${formatList(copiedAgents)}`));
        p.log.message(chalk.dim('  Files were copied instead. On Windows, enable Developer Mode for symlink support.'));
      }
    }

    if (failed.length > 0) {
      console.log();
      p.log.error(chalk.red(`Failed to install ${failed.length}`));
      for (const r of failed) {
        p.log.message(`  ${chalk.red('✗')} ${r.skill} → ${r.agent}: ${chalk.dim(r.error)}`);
      }
    }

    console.log();
    p.outro(chalk.green('Done!'));
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : 'Unknown error occurred');
    p.outro(chalk.red('Installation failed'));
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
