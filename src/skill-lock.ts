import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.skill-lock.json';
const CURRENT_VERSION = 3; // Bumped from 2 to 3 for folder hash support (GitHub tree SHA)

/**
 * Represents a single installed skill entry in the lock file.
 */
export interface SkillLockEntry {
  /** Normalized source identifier (e.g., "owner/repo", "mintlify/bun.com") */
  source: string;
  /** The provider/source type (e.g., "github", "mintlify", "huggingface", "local") */
  sourceType: string;
  /** The original URL used to install the skill (for re-fetching updates) */
  sourceUrl: string;
  /** Subpath within the source repo, if applicable */
  skillPath?: string;
  /**
   * GitHub tree SHA for the entire skill folder.
   * This hash changes when ANY file in the skill folder changes.
   * Fetched via GitHub Trees API by the telemetry server.
   */
  skillFolderHash: string;
  /** ISO timestamp when the skill was first installed */
  installedAt: string;
  /** ISO timestamp when the skill was last updated */
  updatedAt: string;
}

/**
 * Tracks dismissed prompts so they're not shown again.
 */
export interface DismissedPrompts {
  /** Dismissed the find-skills skill installation prompt */
  findSkillsPrompt?: boolean;
}

/**
 * The structure of the skill lock file.
 */
export interface SkillLockFile {
  /** Schema version for future migrations */
  version: number;
  /** Map of skill name to its lock entry */
  skills: Record<string, SkillLockEntry>;
  /** Tracks dismissed prompts */
  dismissed?: DismissedPrompts;
}

/**
 * Get the path to the skill lock file.
 * @param global - If true, uses ~/.agents; if false, uses ./.agents in cwd
 */
export function getSkillLockPath(global: boolean = true): string {
  const baseDir = global ? homedir() : process.cwd();
  return join(baseDir, AGENTS_DIR, LOCK_FILE);
}

/**
 * Read the skill lock file.
 * Returns an empty lock file structure if the file doesn't exist.
 * Wipes the lock file if it's an old format (version < CURRENT_VERSION).
 * @param global - If true, reads from ~/.agents; if false, reads from ./.agents
 */
export async function readSkillLock(global: boolean = true): Promise<SkillLockFile> {
  const lockPath = getSkillLockPath(global);

  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as SkillLockFile;

    // Validate version - wipe if old format
    if (typeof parsed.version !== 'number' || !parsed.skills) {
      return createEmptyLockFile();
    }

    // If old version, wipe and start fresh (backwards incompatible change)
    // v3 adds skillFolderHash - we want fresh installs to populate it
    if (parsed.version < CURRENT_VERSION) {
      return createEmptyLockFile();
    }

    return parsed;
  } catch (error) {
    // File doesn't exist or is invalid - return empty
    return createEmptyLockFile();
  }
}

/**
 * Write the skill lock file.
 * Creates the directory if it doesn't exist.
 * @param lock - The lock file data to write
 * @param global - If true, writes to ~/.agents; if false, writes to ./.agents
 */
export async function writeSkillLock(lock: SkillLockFile, global: boolean = true): Promise<void> {
  const lockPath = getSkillLockPath(global);

  // Ensure directory exists
  await mkdir(dirname(lockPath), { recursive: true });

  // Write with pretty formatting for human readability
  const content = JSON.stringify(lock, null, 2);
  await writeFile(lockPath, content, 'utf-8');
}

/**
 * Compute SHA-256 hash of content.
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Fetch the tree SHA (folder hash) for a skill folder using GitHub's Trees API.
 * This makes ONE API call to get the entire repo tree, then extracts the SHA
 * for the specific skill folder.
 *
 * @param ownerRepo - GitHub owner/repo (e.g., "vercel-labs/agent-skills")
 * @param skillPath - Path to skill folder or SKILL.md (e.g., "skills/react-best-practices/SKILL.md")
 * @returns The tree SHA for the skill folder, or null if not found
 */
export async function fetchSkillFolderHash(
  ownerRepo: string,
  skillPath: string
): Promise<string | null> {
  // Normalize the skill path - remove SKILL.md suffix to get folder path
  let folderPath = skillPath;
  if (folderPath.endsWith('/SKILL.md')) {
    folderPath = folderPath.slice(0, -9);
  } else if (folderPath.endsWith('SKILL.md')) {
    folderPath = folderPath.slice(0, -8);
  }
  if (folderPath.endsWith('/')) {
    folderPath = folderPath.slice(0, -1);
  }

  const branches = ['main', 'master'];

  for (const branch of branches) {
    try {
      const url = `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'skills-cli',
        },
      });

      if (!response.ok) continue;

      const data = (await response.json()) as {
        sha: string;
        tree: Array<{ path: string; type: string; sha: string }>;
      };

      // If folderPath is empty, this is a root-level skill - use the root tree SHA
      if (!folderPath) {
        return data.sha;
      }

      // Find the tree entry for the skill folder
      const folderEntry = data.tree.find(
        (entry) => entry.type === 'tree' && entry.path === folderPath
      );

      if (folderEntry) {
        return folderEntry.sha;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Add or update a skill entry in the lock file.
 * @param skillName - The name of the skill
 * @param entry - The skill entry data
 * @param global - If true, uses ~/.agents; if false, uses ./.agents
 */
export async function addSkillToLock(
  skillName: string,
  entry: Omit<SkillLockEntry, 'installedAt' | 'updatedAt'>,
  global: boolean = true
): Promise<void> {
  const lock = await readSkillLock(global);
  const now = new Date().toISOString();

  const existingEntry = lock.skills[skillName];

  lock.skills[skillName] = {
    ...entry,
    installedAt: existingEntry?.installedAt ?? now,
    updatedAt: now,
  };

  await writeSkillLock(lock, global);
}

/**
 * Remove a skill from the lock file.
 * @param skillName - The name of the skill to remove
 * @param global - If true, uses ~/.agents; if false, uses ./.agents
 */
export async function removeSkillFromLock(
  skillName: string,
  global: boolean = true
): Promise<boolean> {
  const lock = await readSkillLock(global);

  if (!(skillName in lock.skills)) {
    return false;
  }

  delete lock.skills[skillName];
  await writeSkillLock(lock, global);
  return true;
}

/**
 * Get a skill entry from the lock file.
 * @param skillName - The name of the skill
 * @param global - If true, reads from ~/.agents; if false, reads from ./.agents
 */
export async function getSkillFromLock(
  skillName: string,
  global: boolean = true
): Promise<SkillLockEntry | null> {
  const lock = await readSkillLock(global);
  return lock.skills[skillName] ?? null;
}

/**
 * Get all skills from the lock file.
 * @param global - If true, reads from ~/.agents; if false, reads from ./.agents
 */
export async function getAllLockedSkills(
  global: boolean = true
): Promise<Record<string, SkillLockEntry>> {
  const lock = await readSkillLock(global);
  return lock.skills;
}

/**
 * Get skills grouped by source for batch update operations.
 * @param global - If true, reads from ~/.agents; if false, reads from ./.agents
 */
export async function getSkillsBySource(
  global: boolean = true
): Promise<Map<string, { skills: string[]; entry: SkillLockEntry }>> {
  const lock = await readSkillLock(global);
  const bySource = new Map<string, { skills: string[]; entry: SkillLockEntry }>();

  for (const [skillName, entry] of Object.entries(lock.skills)) {
    const existing = bySource.get(entry.source);
    if (existing) {
      existing.skills.push(skillName);
    } else {
      bySource.set(entry.source, { skills: [skillName], entry });
    }
  }

  return bySource;
}

/**
 * Create an empty lock file structure.
 */
function createEmptyLockFile(): SkillLockFile {
  return {
    version: CURRENT_VERSION,
    skills: {},
    dismissed: {},
  };
}

/**
 * Check if a prompt has been dismissed.
 * @param promptKey - The key of the prompt to check
 * @param global - If true, reads from ~/.agents; if false, reads from ./.agents
 */
export async function isPromptDismissed(
  promptKey: keyof DismissedPrompts,
  global: boolean = true
): Promise<boolean> {
  const lock = await readSkillLock(global);
  return lock.dismissed?.[promptKey] === true;
}

/**
 * Mark a prompt as dismissed.
 * @param promptKey - The key of the prompt to dismiss
 * @param global - If true, writes to ~/.agents; if false, writes to ./.agents
 */
export async function dismissPrompt(
  promptKey: keyof DismissedPrompts,
  global: boolean = true
): Promise<void> {
  const lock = await readSkillLock(global);
  if (!lock.dismissed) {
    lock.dismissed = {};
  }
  lock.dismissed[promptKey] = true;
  await writeSkillLock(lock, global);
}
