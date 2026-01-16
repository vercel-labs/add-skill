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

export async function cloneRepo(url: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'add-skill-'));
  const git = simpleGit();
  await git.clone(url, tempDir, ['--depth', '1']);
  return tempDir;
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
