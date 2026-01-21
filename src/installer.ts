import { mkdir, cp, access, readdir, symlink, lstat, rm, readlink } from 'fs/promises';
import { join, basename, normalize, resolve, sep, relative } from 'path';
import { homedir, platform } from 'os';
import type { Skill, AgentType } from './types.js';
import { agents } from './agents.js';

const AGENTS_DIR = '.agents';
const SKILLS_SUBDIR = 'skills';

interface InstallResult {
  success: boolean;
  path: string;
  canonicalPath?: string;
  symlinkFailed?: boolean;
  error?: string;
}

/**
 * Sanitizes a filename/directory name to prevent path traversal attacks
 * @param name - The name to sanitize
 * @returns Sanitized name safe for use in file paths
 */
function sanitizeName(name: string): string {
  let sanitized = name.replace(/[\/\\:\0]/g, '');
  sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');
  sanitized = sanitized.replace(/^\.+/, '');
  
  if (!sanitized || sanitized.length === 0) {
    sanitized = 'unnamed-skill';
  }
  
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }
  
  return sanitized;
}

/**
 * Validates that a path is within an expected base directory
 * @param basePath - The expected base directory
 * @param targetPath - The path to validate
 * @returns true if targetPath is within basePath
 */
function isPathSafe(basePath: string, targetPath: string): boolean {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(targetPath));
  
  return normalizedTarget.startsWith(normalizedBase + sep) || 
         normalizedTarget === normalizedBase;
}

/**
 * Gets the canonical .agents/skills directory path
 * @param global - Whether to use global (home) or project-level location
 * @param cwd - Current working directory for project-level installs
 */
function getCanonicalSkillsDir(global: boolean, cwd?: string): string {
  const baseDir = global ? homedir() : (cwd || process.cwd());
  return join(baseDir, AGENTS_DIR, SKILLS_SUBDIR);
}

/**
 * Creates a symlink, handling cross-platform differences
 * Returns true if symlink was created, false if fallback to copy is needed
 */
async function createSymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    try {
      const stats = await lstat(linkPath);
      if (stats.isSymbolicLink()) {
        const existingTarget = await readlink(linkPath);
        if (resolve(existingTarget) === resolve(target)) {
          return true;
        }
        await rm(linkPath);
      } else {
        await rm(linkPath, { recursive: true });
      }
    } catch {
      // Doesn't exist
    }

    const linkDir = join(linkPath, '..');
    await mkdir(linkDir, { recursive: true });

    const relativePath = relative(linkDir, target);
    const symlinkType = platform() === 'win32' ? 'junction' : undefined;
    
    await symlink(relativePath, linkPath, symlinkType);
    return true;
  } catch {
    return false;
  }
}

export async function installSkillForAgent(
  skill: Skill,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; noSymlink?: boolean } = {}
): Promise<InstallResult> {
  const agent = agents[agentType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  
  // Sanitize skill name to prevent directory traversal
  const rawSkillName = skill.name || basename(skill.path);
  const skillName = sanitizeName(rawSkillName);
  
  // Canonical location: .agents/skills/<skill-name>
  const canonicalBase = getCanonicalSkillsDir(isGlobal, cwd);
  const canonicalDir = join(canonicalBase, skillName);
  
  // Agent-specific location (for symlink)
  const agentBase = isGlobal
    ? agent.globalSkillsDir
    : join(cwd, agent.skillsDir);
  const agentDir = join(agentBase, skillName);
  
  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: agentDir,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }
  
  if (!isPathSafe(agentBase, agentDir)) {
    return {
      success: false,
      path: agentDir,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    await mkdir(canonicalDir, { recursive: true });
    await copyDirectory(skill.path, canonicalDir);

    // If noSymlink is requested, copy directly instead of creating symlinks
    if (options.noSymlink) {
      await mkdir(agentDir, { recursive: true });
      await copyDirectory(skill.path, agentDir);

      return {
        success: true,
        path: agentDir,
        canonicalPath: canonicalDir,
      };
    }

    const symlinkCreated = await createSymlink(canonicalDir, agentDir);

    if (!symlinkCreated) {
      await mkdir(agentDir, { recursive: true });
      await copyDirectory(skill.path, agentDir);

      return {
        success: true,
        path: agentDir,
        canonicalPath: canonicalDir,
        symlinkFailed: true,
      };
    }

    return {
      success: true,
      path: agentDir,
      canonicalPath: canonicalDir,
    };
  } catch (error) {
    return {
      success: false,
      path: agentDir,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

const EXCLUDE_FILES = new Set([
  'README.md',
  'metadata.json',
]);

const isExcluded = (name: string): boolean => {
  if (EXCLUDE_FILES.has(name)) return true;
  if (name.startsWith('_')) return true;
  return false;
};

async function copyDirectory(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (isExcluded(entry.name)) {
      continue;
    }

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
  options: { global?: boolean; cwd?: string } = {}
): Promise<boolean> {
  const agent = agents[agentType];
  const sanitized = sanitizeName(skillName);
  
  const targetBase = options.global
    ? agent.globalSkillsDir
    : join(options.cwd || process.cwd(), agent.skillsDir);
  
  const skillDir = join(targetBase, sanitized);
  
  if (!isPathSafe(targetBase, skillDir)) {
    return false;
  }

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
  options: { global?: boolean; cwd?: string } = {}
): string {
  const agent = agents[agentType];
  const cwd = options.cwd || process.cwd();
  const sanitized = sanitizeName(skillName);
  
  const targetBase = options.global
    ? agent.globalSkillsDir
    : join(cwd, agent.skillsDir);
  
  const installPath = join(targetBase, sanitized);
  
  if (!isPathSafe(targetBase, installPath)) {
    throw new Error('Invalid skill name: potential path traversal detected');
  }
  
  return installPath;
}

/**
 * Gets the canonical .agents/skills/<skill> path
 */
export function getCanonicalPath(
  skillName: string,
  options: { global?: boolean; cwd?: string } = {}
): string {
  const sanitized = sanitizeName(skillName);
  const canonicalBase = getCanonicalSkillsDir(options.global ?? false, options.cwd);
  const canonicalPath = join(canonicalBase, sanitized);
  
  if (!isPathSafe(canonicalBase, canonicalPath)) {
    throw new Error('Invalid skill name: potential path traversal detected');
  }
  
  return canonicalPath;
}
