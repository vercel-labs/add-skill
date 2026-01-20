#!/usr/bin/env node

import { program } from 'commander';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { parseSource, getOwnerRepo } from './source-parser.js';
import { cloneRepo, cleanupTempDir } from './git.js';
import { discoverSkills, getSkillDisplayName } from './skills.js';
import { installSkillForAgent, isSkillInstalled, getInstallPath } from './installer.js';
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
  .description('Install skills onto coding agents (OpenCode, Claude Code, Codex, Kiro CLI, Cursor, Antigravity, Github Copilot, Roo Code)')
  .version(version)
  .argument('<source>', 'Git repo URL, GitHub shorthand (owner/repo), local path (./path), or direct path to skill')
  .option('-g, --global', 'Install skill globally (user-level) instead of project-level')
  .option('-a, --agent <agents...>', 'Specify agents to install to (opencode, claude-code, codex, kiro-cli, cursor, antigravity, github-copilot, roo)')
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
  // --all implies -y and -g
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
      // Use local path directly, no cloning needed
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
      // Clone repository for remote sources
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
      // --all flag: install to all agents without detection
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

    // Build installation summary table
    const summaryLines: string[] = [];
    
    // Find the longest agent name for padding
    const maxAgentLen = Math.max(...targetAgents.map(a => agents[a].displayName.length));
    
    // Check if any skill will be overwritten
    const overwriteStatus = new Map<string, Map<string, boolean>>();
    for (const skill of selectedSkills) {
      const agentStatus = new Map<string, boolean>();
      for (const agent of targetAgents) {
        agentStatus.set(agent, await isSkillInstalled(skill.name, agent, { global: installGlobally }));
      }
      overwriteStatus.set(skill.name, agentStatus);
    }
    
    for (const skill of selectedSkills) {
      if (summaryLines.length > 0) summaryLines.push(''); // separator between skills
      summaryLines.push(chalk.bold.cyan(getSkillDisplayName(skill)));
      summaryLines.push('');
      summaryLines.push(`  ${chalk.bold('Agent'.padEnd(maxAgentLen + 2))}${chalk.bold('Directory')}`);
      
      for (const agent of targetAgents) {
        const fullPath = getInstallPath(skill.name, agent, { global: installGlobally });
        // Strip the skill name from the end to show just the base directory
        const basePath = fullPath.replace(/\/[^/]+$/, '/');
        const installed = overwriteStatus.get(skill.name)?.get(agent) ?? false;
        const status = installed ? chalk.yellow(' (overwrite)') : '';
        const agentName = agents[agent].displayName.padEnd(maxAgentLen + 2);
        summaryLines.push(`  ${agentName}${chalk.dim(basePath)}${status}`);
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

    const results: { skill: string; agent: string; success: boolean; path: string; error?: string }[] = [];

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
        skills: selectedSkills.map(s => s.name).join(','),
        agents: targetAgents.join(','),
        ...(installGlobally && { global: '1' }),
        skillFiles: JSON.stringify(skillFiles),
      });
    }

    if (successful.length > 0) {
      // Group by skill name for cleaner output
      const bySkill = new Map<string, string[]>();
      for (const r of successful) {
        const skillAgents = bySkill.get(r.skill) || [];
        skillAgents.push(r.agent);
        bySkill.set(r.skill, skillAgents);
      }
      
      const skillCount = bySkill.size;
      const agentCount = new Set(successful.map(r => r.agent)).size;
      
      // Build results list
      const resultLines: string[] = [];
      
      for (const [skill, skillAgents] of bySkill) {
        resultLines.push(`${chalk.green('✓')} ${chalk.bold(skill)}`);
        for (const agent of skillAgents) {
          resultLines.push(`  ${chalk.dim(agent)}`);
        }
        resultLines.push(''); // blank line between skills
      }
      
      // Remove trailing blank line
      if (resultLines.length > 0 && resultLines[resultLines.length - 1] === '') {
        resultLines.pop();
      }
      
      const title = chalk.green(`Installed ${skillCount} skill${skillCount !== 1 ? 's' : ''} to ${agentCount} agent${agentCount !== 1 ? 's' : ''}`);
      p.note(resultLines.join('\n'), title);
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
