import {
  mkdir,
  cp,
  access,
  readdir,
  symlink,
  lstat,
  rm,
  readlink,
  writeFile,
  stat,
} from 'fs/promises';
import { join, basename, normalize, resolve, sep, relative, dirname } from 'path';
import { homedir, platform } from 'os';
import type { Skill, AgentType, MintlifySkill, RemoteSkill } from './types.ts';
import type { WellKnownSkill } from './providers/wellknown.ts';
import { agents, detectInstalledAgents, getAgentSkillsDir } from './agents.ts';
import { AGENTS_DIR, SKILLS_SUBDIR } from './constants.ts';
import { parseSkillMd } from './skills.ts';
import { getConfig } from './config.ts';

export type InstallMode = 'symlink' | 'copy';

interface InstallResult {
  success: boolean;
  path: string;
  canonicalPath?: string;
  mode: InstallMode;
  symlinkFailed?: boolean;
  error?: string;
}

/**
 * Sanitizes a filename/directory name to prevent path traversal attacks
 * and ensures it follows kebab-case convention
 * @param name - The name to sanitize
 * @returns Sanitized name safe for use in file paths
 */
export function sanitizeName(name: string): string {
  const sanitized = name
    .toLowerCase()
    // Replace any sequence of characters that are NOT lowercase letters (a-z),
    // digits (0-9), dots (.), or underscores (_) with a single hyphen.
    // This converts spaces, special chars, and path traversal attempts (../) into hyphens.
    .replace(/[^a-z0-9._]+/g, '-')
    // Remove leading/trailing dots and hyphens to prevent hidden files (.) and
    // ensure clean directory names. The pattern matches:
    // - ^[.\-]+ : one or more dots or hyphens at the start
    // - [.\-]+$ : one or more dots or hyphens at the end
    .replace(/^[.\-]+|[.\-]+$/g, '');

  // Limit to 255 chars (common filesystem limit), fallback to 'unnamed-skill' if empty
  return sanitized.substring(0, 255) || 'unnamed-skill';
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

  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

/**
 * Gets the canonical .agents/skills directory path
 * @param global - Whether to use global (home) or project-level location
 * @param cwd - Current working directory for project-level installs
 */
export function getCanonicalSkillsDir(global: boolean, cwd?: string): string {
  const config = getConfig();

  // Check for config override
  if (global && config.canonicalDir?.global) {
    return config.canonicalDir.global;
  }
  if (!global && config.canonicalDir?.project) {
    return join(cwd || process.cwd(), config.canonicalDir.project);
  }

  // Fall back to default
  const baseDir = global ? homedir() : cwd || process.cwd();
  return join(baseDir, AGENTS_DIR, SKILLS_SUBDIR);
}

function resolveSymlinkTarget(linkPath: string, linkTarget: string): string {
  return resolve(dirname(linkPath), linkTarget);
}

/**
 * Cleans and recreates a directory for skill installation.
 *
 * This ensures:
 * 1. Renamed/deleted files from previous installs are removed
 * 2. Symlinks (including self-referential ones causing ELOOP) are handled
 *    when canonical and agent paths resolve to the same location
 */
async function cleanAndCreateDirectory(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors - mkdir will fail if there's a real problem
  }
  await mkdir(path, { recursive: true });
}

/**
 * Creates a symlink, handling cross-platform differences
 * Returns true if symlink was created, false if fallback to copy is needed
 */
async function createSymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    const resolvedTarget = resolve(target);
    const resolvedLinkPath = resolve(linkPath);

    if (resolvedTarget === resolvedLinkPath) {
      return true;
    }

    try {
      const stats = await lstat(linkPath);
      if (stats.isSymbolicLink()) {
        const existingTarget = await readlink(linkPath);
        if (resolveSymlinkTarget(linkPath, existingTarget) === resolvedTarget) {
          return true;
        }
        await rm(linkPath);
      } else {
        await rm(linkPath, { recursive: true });
      }
    } catch (err: unknown) {
      // ELOOP = circular symlink, ENOENT = doesn't exist
      // For ELOOP, try to remove the broken symlink
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ELOOP') {
        try {
          await rm(linkPath, { force: true });
        } catch {
          // If we can't remove it, symlink creation will fail and trigger copy fallback
        }
      }
      // For ENOENT or other errors, continue to symlink creation
    }

    const linkDir = dirname(linkPath);
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
  options: { global?: boolean; cwd?: string; mode?: InstallMode } = {}
): Promise<InstallResult> {
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const agent = agents[agentType];

  // Check if agent supports global installation
  if (isGlobal && agent.globalSkillsDir === undefined) {
    return {
      success: false,
      path: '',
      mode: options.mode ?? 'symlink',
      error: `${agent.displayName} does not support global skill installation`,
    };
  }

  // Sanitize skill name to prevent directory traversal
  const rawSkillName = skill.name || basename(skill.path);
  const skillName = sanitizeName(rawSkillName);

  // Canonical location: .agents/skills/<skill-name>
  const canonicalBase = getCanonicalSkillsDir(isGlobal, cwd);
  const canonicalDir = join(canonicalBase, skillName);

  // Agent-specific location (for symlink)
  const agentBase = getAgentSkillsDir(agentType, isGlobal, cwd);
  const agentDir = join(agentBase, skillName);

  const installMode = options.mode ?? 'symlink';

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  if (!isPathSafe(agentBase, agentDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    // For copy mode, skip canonical directory and copy directly to agent location
    if (installMode === 'copy') {
      await cleanAndCreateDirectory(agentDir);
      await copyDirectory(skill.path, agentDir);

      return {
        success: true,
        path: agentDir,
        mode: 'copy',
      };
    }

    // Symlink mode: copy to canonical location and symlink to agent location
    await cleanAndCreateDirectory(canonicalDir);
    await copyDirectory(skill.path, canonicalDir);

    const symlinkCreated = await createSymlink(canonicalDir, agentDir);

    if (!symlinkCreated) {
      // Symlink failed, fall back to copy
      await cleanAndCreateDirectory(agentDir);
      await copyDirectory(skill.path, agentDir);

      return {
        success: true,
        path: agentDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
        symlinkFailed: true,
      };
    }

    return {
      success: true,
      path: agentDir,
      canonicalPath: canonicalDir,
      mode: 'symlink',
    };
  } catch (error) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

const EXCLUDE_FILES = new Set(['README.md', 'metadata.json']);
const EXCLUDE_DIRS = new Set(['.git']);

const isExcluded = (name: string, isDirectory: boolean = false): boolean => {
  if (EXCLUDE_FILES.has(name)) return true;
  if (name.startsWith('_')) return true;
  if (isDirectory && EXCLUDE_DIRS.has(name)) return true;
  return false;
};

async function copyDirectory(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });

  // Copy files and directories in parallel
  await Promise.all(
    entries
      .filter((entry) => !isExcluded(entry.name, entry.isDirectory()))
      .map(async (entry) => {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);

        if (entry.isDirectory()) {
          await copyDirectory(srcPath, destPath);
        } else {
          await cp(srcPath, destPath, {
            // If the file is a symlink to elsewhere in a remote skill, it may not
            // resolve correctly once it has been copied to the local location.
            // `dereference: true` tells Node to copy the file instead of copying
            // the symlink. `recursive: true` handles symlinks pointing to directories.
            dereference: true,
            recursive: true,
          });
        }
      })
  );
}

export async function isSkillInstalled(
  skillName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string } = {}
): Promise<boolean> {
  const sanitized = sanitizeName(skillName);

  const targetBase = getAgentSkillsDir(agentType, options.global ?? false, options.cwd);
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
  const sanitized = sanitizeName(skillName);

  const targetBase = getAgentSkillsDir(agentType, options.global ?? false, options.cwd);
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

/**
 * Install a Mintlify skill from a direct URL
 * The skill name is derived from the mintlify-proj frontmatter
 * Supports symlink mode (writes to canonical location and symlinks to agent dirs)
 * or copy mode (writes directly to each agent dir).
 * @deprecated Use installRemoteSkillForAgent instead
 */
export async function installMintlifySkillForAgent(
  skill: MintlifySkill,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode } = {}
): Promise<InstallResult> {
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const installMode = options.mode ?? 'symlink';
  const agent = agents[agentType];

  // Check if agent supports global installation
  if (isGlobal && agent.globalSkillsDir === undefined) {
    return {
      success: false,
      path: '',
      mode: installMode,
      error: `${agent.displayName} does not support global skill installation`,
    };
  }

  // Use mintlify-proj as the skill directory name (e.g., "bun.com")
  const skillName = sanitizeName(skill.mintlifySite);

  // Canonical location: .agents/skills/<skill-name>
  const canonicalBase = getCanonicalSkillsDir(isGlobal, cwd);
  const canonicalDir = join(canonicalBase, skillName);

  // Agent-specific location (for symlink)
  const agentBase = getAgentSkillsDir(agentType, isGlobal, cwd);
  const agentDir = join(agentBase, skillName);

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  if (!isPathSafe(agentBase, agentDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    // For copy mode, write directly to agent location
    if (installMode === 'copy') {
      await cleanAndCreateDirectory(agentDir);
      const skillMdPath = join(agentDir, 'SKILL.md');
      await writeFile(skillMdPath, skill.content, 'utf-8');

      return {
        success: true,
        path: agentDir,
        mode: 'copy',
      };
    }

    // Symlink mode: write to canonical location and symlink to agent location
    await cleanAndCreateDirectory(canonicalDir);
    const skillMdPath = join(canonicalDir, 'SKILL.md');
    await writeFile(skillMdPath, skill.content, 'utf-8');

    const symlinkCreated = await createSymlink(canonicalDir, agentDir);

    if (!symlinkCreated) {
      // Symlink failed, fall back to copy
      await cleanAndCreateDirectory(agentDir);
      const agentSkillMdPath = join(agentDir, 'SKILL.md');
      await writeFile(agentSkillMdPath, skill.content, 'utf-8');

      return {
        success: true,
        path: agentDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
        symlinkFailed: true,
      };
    }

    return {
      success: true,
      path: agentDir,
      canonicalPath: canonicalDir,
      mode: 'symlink',
    };
  } catch (error) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Install a remote skill from any host provider.
 * The skill directory name is derived from the installName field.
 * Supports symlink mode (writes to canonical location and symlinks to agent dirs)
 * or copy mode (writes directly to each agent dir).
 */
export async function installRemoteSkillForAgent(
  skill: RemoteSkill,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode } = {}
): Promise<InstallResult> {
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const installMode = options.mode ?? 'symlink';
  const agent = agents[agentType];

  // Check if agent supports global installation
  if (isGlobal && agent.globalSkillsDir === undefined) {
    return {
      success: false,
      path: '',
      mode: installMode,
      error: `${agent.displayName} does not support global skill installation`,
    };
  }

  // Use installName as the skill directory name
  const skillName = sanitizeName(skill.installName);

  // Canonical location: .agents/skills/<skill-name>
  const canonicalBase = getCanonicalSkillsDir(isGlobal, cwd);
  const canonicalDir = join(canonicalBase, skillName);

  // Agent-specific location (for symlink)
  const agentBase = getAgentSkillsDir(agentType, isGlobal, cwd);
  const agentDir = join(agentBase, skillName);

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  if (!isPathSafe(agentBase, agentDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    // For copy mode, write directly to agent location
    if (installMode === 'copy') {
      await cleanAndCreateDirectory(agentDir);
      const skillMdPath = join(agentDir, 'SKILL.md');
      await writeFile(skillMdPath, skill.content, 'utf-8');

      return {
        success: true,
        path: agentDir,
        mode: 'copy',
      };
    }

    // Symlink mode: write to canonical location and symlink to agent location
    await cleanAndCreateDirectory(canonicalDir);
    const skillMdPath = join(canonicalDir, 'SKILL.md');
    await writeFile(skillMdPath, skill.content, 'utf-8');

    const symlinkCreated = await createSymlink(canonicalDir, agentDir);

    if (!symlinkCreated) {
      // Symlink failed, fall back to copy
      await cleanAndCreateDirectory(agentDir);
      const agentSkillMdPath = join(agentDir, 'SKILL.md');
      await writeFile(agentSkillMdPath, skill.content, 'utf-8');

      return {
        success: true,
        path: agentDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
        symlinkFailed: true,
      };
    }

    return {
      success: true,
      path: agentDir,
      canonicalPath: canonicalDir,
      mode: 'symlink',
    };
  } catch (error) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Install a well-known skill with multiple files.
 * The skill directory name is derived from the installName field.
 * All files from the skill's files map are written to the installation directory.
 * Supports symlink mode (writes to canonical location and symlinks to agent dirs)
 * or copy mode (writes directly to each agent dir).
 */
export async function installWellKnownSkillForAgent(
  skill: WellKnownSkill,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode } = {}
): Promise<InstallResult> {
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const installMode = options.mode ?? 'symlink';
  const agent = agents[agentType];

  // Check if agent supports global installation
  if (isGlobal && agent.globalSkillsDir === undefined) {
    return {
      success: false,
      path: '',
      mode: installMode,
      error: `${agent.displayName} does not support global skill installation`,
    };
  }

  // Use installName as the skill directory name
  const skillName = sanitizeName(skill.installName);

  // Canonical location: .agents/skills/<skill-name>
  const canonicalBase = getCanonicalSkillsDir(isGlobal, cwd);
  const canonicalDir = join(canonicalBase, skillName);

  // Agent-specific location (for symlink)
  const agentBase = getAgentSkillsDir(agentType, isGlobal, cwd);
  const agentDir = join(agentBase, skillName);

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  if (!isPathSafe(agentBase, agentDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  /**
   * Write all skill files to a directory (assumes directory already exists)
   */
  async function writeSkillFiles(targetDir: string): Promise<void> {
    for (const [filePath, content] of skill.files) {
      // Validate file path doesn't escape the target directory
      const fullPath = join(targetDir, filePath);
      if (!isPathSafe(targetDir, fullPath)) {
        continue; // Skip files that would escape the directory
      }

      // Create parent directories if needed
      const parentDir = dirname(fullPath);
      if (parentDir !== targetDir) {
        await mkdir(parentDir, { recursive: true });
      }

      await writeFile(fullPath, content, 'utf-8');
    }
  }

  try {
    // For copy mode, write directly to agent location
    if (installMode === 'copy') {
      await cleanAndCreateDirectory(agentDir);
      await writeSkillFiles(agentDir);

      return {
        success: true,
        path: agentDir,
        mode: 'copy',
      };
    }

    // Symlink mode: write to canonical location and symlink to agent location
    await cleanAndCreateDirectory(canonicalDir);
    await writeSkillFiles(canonicalDir);

    const symlinkCreated = await createSymlink(canonicalDir, agentDir);

    if (!symlinkCreated) {
      // Symlink failed, fall back to copy
      await cleanAndCreateDirectory(agentDir);
      await writeSkillFiles(agentDir);

      return {
        success: true,
        path: agentDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
        symlinkFailed: true,
      };
    }

    return {
      success: true,
      path: agentDir,
      canonicalPath: canonicalDir,
      mode: 'symlink',
    };
  } catch (error) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export interface InstalledSkill {
  name: string;
  description: string;
  path: string;
  canonicalPath: string;
  scope: 'project' | 'global';
  agents: AgentType[];
}

/**
 * Lists all installed skills from canonical locations
 * @param options - Options for listing skills
 * @returns Array of installed skills with metadata
 */
export async function listInstalledSkills(
  options: {
    global?: boolean;
    cwd?: string;
    agentFilter?: AgentType[];
  } = {}
): Promise<InstalledSkill[]> {
  const cwd = options.cwd || process.cwd();
  const installedSkills: InstalledSkill[] = [];
  const scopes: Array<{ global: boolean; path: string }> = [];

  // Detect which agents are actually installed (fixes issue #225)
  const detectedAgents = await detectInstalledAgents();

  // Determine which scopes to scan
  if (options.global === undefined) {
    // Scan both project and global
    scopes.push({ global: false, path: getCanonicalSkillsDir(false, cwd) });
    scopes.push({ global: true, path: getCanonicalSkillsDir(true, cwd) });
  } else {
    // Scan only specified scope
    scopes.push({ global: options.global, path: getCanonicalSkillsDir(options.global, cwd) });
  }

  for (const scope of scopes) {
    try {
      const entries = await readdir(scope.path, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const skillDir = join(scope.path, entry.name);
        const skillMdPath = join(skillDir, 'SKILL.md');

        // Check if SKILL.md exists
        try {
          await stat(skillMdPath);
        } catch {
          // SKILL.md doesn't exist, skip this directory
          continue;
        }

        // Parse the skill
        const skill = await parseSkillMd(skillMdPath);
        if (!skill) {
          continue;
        }

        // Find which agents have this skill installed
        // Use multiple strategies to handle mismatches between canonical and agent directories
        const sanitizedSkillName = sanitizeName(skill.name);
        const installedAgents: AgentType[] = [];
        // Only check installed agents, with optional filter
        // Assign to a new variable to make below ts infer happy
        const agentFilter = options.agentFilter;
        const agentsToCheck = agentFilter
          ? detectedAgents.filter((a) => agentFilter.includes(a))
          : detectedAgents;

        for (const agentType of agentsToCheck) {
          const agentBase = getAgentSkillsDir(agentType, scope.global, cwd);

          let found = false;

          // Strategy 1: Try exact directory name matches (fast path)
          const possibleNames = [
            entry.name,
            sanitizedSkillName,
            skill.name
              .toLowerCase()
              .replace(/\s+/g, '-')
              .replace(/[\/\\:\0]/g, ''),
          ];
          const uniqueNames = Array.from(new Set(possibleNames));

          for (const possibleName of uniqueNames) {
            const agentSkillDir = join(agentBase, possibleName);

            if (!isPathSafe(agentBase, agentSkillDir)) {
              continue;
            }

            try {
              await access(agentSkillDir);
              found = true;
              break;
            } catch {
              // Try next name
            }
          }

          // Strategy 2: If not found, scan all directories and check SKILL.md files
          // This handles cases where directory names don't match (e.g., "git-review" vs "Git Review Before Commit")
          if (!found) {
            try {
              const agentEntries = await readdir(agentBase, { withFileTypes: true });
              for (const agentEntry of agentEntries) {
                if (!agentEntry.isDirectory()) {
                  continue;
                }

                const candidateDir = join(agentBase, agentEntry.name);
                if (!isPathSafe(agentBase, candidateDir)) {
                  continue;
                }

                try {
                  const candidateSkillMd = join(candidateDir, 'SKILL.md');
                  await stat(candidateSkillMd);
                  const candidateSkill = await parseSkillMd(candidateSkillMd);
                  if (candidateSkill && candidateSkill.name === skill.name) {
                    found = true;
                    break;
                  }
                } catch {
                  // Not a valid skill directory or SKILL.md doesn't exist
                }
              }
            } catch {
              // Agent base directory doesn't exist
            }
          }

          if (found) {
            installedAgents.push(agentType);
          }
        }

        // Always include the skill, showing which agents have it installed
        installedSkills.push({
          name: skill.name,
          description: skill.description,
          path: skillDir,
          canonicalPath: skillDir,
          scope: scope.global ? 'global' : 'project',
          agents: installedAgents,
        });
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return installedSkills;
}
