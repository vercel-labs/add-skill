import { mkdir, cp, access, readdir } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import * as p from '@clack/prompts';
import type { Skill, AgentType, CustomGlobalDirs } from './types.js';
import { getAgentConfig } from './agents.js';

interface InstallResult {
  success: boolean;
  path: string;
  error?: string;
}

export async function installSkillForAgent(
  skill: Skill,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; customDirs?: CustomGlobalDirs } = {}
): Promise<InstallResult> {
  const agent = getAgentConfig(agentType, options.customDirs);
  const skillName = skill.name || basename(skill.path);

  const targetBase = options.global
    ? agent.globalSkillsDir
    : join(options.cwd || process.cwd(), agent.skillsDir);

  // Validate custom global directory exists
  if (options.global && options.customDirs?.[agentType]) {
    if (!existsSync(targetBase)) {
      const create = await p.confirm({
        message: `Custom global directory does not exist: ${targetBase}\nWould you like to create it?`,
      });

      if (p.isCancel(create)) {
        return {
          success: false,
          path: targetBase,
          error: 'Installation cancelled',
        };
      }

      if (create) {
        try {
          await mkdir(targetBase, { recursive: true });
        } catch (error) {
          return {
            success: false,
            path: targetBase,
            error: error instanceof Error ? error.message : 'Failed to create directory',
          };
        }
      } else {
        return {
          success: false,
          path: targetBase,
          error: 'Custom directory does not exist and creation was declined',
        };
      }
    }
  }

  const targetDir = join(targetBase, skillName);

  try {
    await mkdir(targetDir, { recursive: true });
    await copyDirectory(skill.path, targetDir);

    return { success: true, path: targetDir };
  } catch (error) {
    return {
      success: false,
      path: targetDir,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function copyDirectory(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await cp(srcPath, destPath);
    }
  }
}

export async function isSkillInstalled(
  skillName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; customDirs?: CustomGlobalDirs } = {}
): Promise<boolean> {
  const agent = getAgentConfig(agentType, options.customDirs);

  const targetBase = options.global
    ? agent.globalSkillsDir
    : join(options.cwd || process.cwd(), agent.skillsDir);

  const skillDir = join(targetBase, skillName);

  try {
    await access(skillDir);
    return true;
  } catch {
    return false;
  }
}

export function getInstallPath(
  skillName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; customDirs?: CustomGlobalDirs } = {}
): string {
  const agent = getAgentConfig(agentType, options.customDirs);

  const targetBase = options.global
    ? agent.globalSkillsDir
    : join(options.cwd || process.cwd(), agent.skillsDir);

  return join(targetBase, skillName);
}
