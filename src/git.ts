import simpleGit from 'simple-git';
import { join, normalize, resolve, sep } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import type { ParsedSource } from './types.js';

export function parseSource(input: string): ParsedSource {
  // GitHub URL with path: https://github.com/owner/repo/tree/branch/path/to/skill
  const githubTreeMatch = input.match(
    /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/
  );
  if (githubTreeMatch) {
    const [, owner, repo, , subpath] = githubTreeMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      subpath,
    };
  }

  // GitHub URL: https://github.com/owner/repo
  const githubRepoMatch = input.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (githubRepoMatch) {
    const [, owner, repo] = githubRepoMatch;
    const cleanRepo = repo!.replace(/\.git$/, '');
    return {
      type: 'github',
      url: `https://github.com/${owner}/${cleanRepo}.git`,
    };
  }

  // GitLab URL with path: https://gitlab.com/owner/repo/-/tree/branch/path
  const gitlabTreeMatch = input.match(
    /gitlab\.com\/([^/]+)\/([^/]+)\/-\/tree\/([^/]+)\/(.+)/
  );
  if (gitlabTreeMatch) {
    const [, owner, repo, , subpath] = gitlabTreeMatch;
    return {
      type: 'gitlab',
      url: `https://gitlab.com/${owner}/${repo}.git`,
      subpath,
    };
  }

  // GitLab URL: https://gitlab.com/owner/repo
  const gitlabRepoMatch = input.match(/gitlab\.com\/([^/]+)\/([^/]+)/);
  if (gitlabRepoMatch) {
    const [, owner, repo] = gitlabRepoMatch;
    const cleanRepo = repo!.replace(/\.git$/, '');
    return {
      type: 'gitlab',
      url: `https://gitlab.com/${owner}/${cleanRepo}.git`,
    };
  }

  // GitHub shorthand: owner/repo or owner/repo/path/to/skill
  const shorthandMatch = input.match(/^([^/]+)\/([^/]+)(?:\/(.+))?$/);
  if (shorthandMatch && !input.includes(':')) {
    const [, owner, repo, subpath] = shorthandMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      subpath,
    };
  }

  // Fallback: treat as direct git URL
  return {
    type: 'git',
    url: input,
  };
}

/**
 * Validates a git URL to prevent injection attacks
 * @param url - The git URL to validate
 * @returns true if the URL is safe
 */
function isValidGitUrl(url: string): boolean {
  // Check for dangerous characters that could be used for injection
  const dangerousPatterns = [
    /\s--/, // Options injection (space followed by --)
    /\s-[a-zA-Z]/, // Short options injection
    /;/, // Command injection
    /\|/, // Pipe injection
    /&/, // Background execution
    /`/, // Command substitution
    /\$\(/, // Command substitution
    />\s*/, // Output redirection
    /<\s*/, // Input redirection
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(url)) {
      return false;
    }
  }

  // Validate URL protocol
  const validProtocols = [
    /^https:\/\//,
    /^http:\/\//,
    /^git:\/\//,
    /^ssh:\/\//,
    /^git@/,
  ];

  const hasValidProtocol = validProtocols.some(protocol => protocol.test(url));
  if (!hasValidProtocol) {
    return false;
  }

  return true;
}

export async function cloneRepo(url: string): Promise<string> {
  // Validate URL to prevent injection attacks
  if (!isValidGitUrl(url)) {
    throw new Error('Invalid or potentially malicious git URL');
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'add-skill-'));
  
  try {
    const git = simpleGit();
    
    // Use object-based options instead of array to prevent option injection
    // simple-git will properly escape and validate these options
    await git.clone(url, tempDir, {
      '--depth': 1,
      '--single-branch': null, // Additional safety: only clone single branch
      '--no-tags': null, // Don't fetch tags to reduce attack surface
    });
    
    return tempDir;
  } catch (error) {
    // Clean up temp directory on error
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function cleanupTempDir(dir: string): Promise<void> {
  // Validate that the directory path is within tmpdir to prevent deletion of arbitrary paths
  const normalizedDir = normalize(resolve(dir));
  const normalizedTmpDir = normalize(resolve(tmpdir()));
  
  if (!normalizedDir.startsWith(normalizedTmpDir + sep) && normalizedDir !== normalizedTmpDir) {
    throw new Error('Attempted to clean up directory outside of temp directory');
  }

  await rm(dir, { recursive: true, force: true });
}
