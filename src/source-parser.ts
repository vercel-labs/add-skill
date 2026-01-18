import { isAbsolute, resolve } from 'path';
import type { ParsedSource } from './types.js';

/**
 * Check if a string represents a local file system path
 */
function isLocalPath(input: string): boolean {
    return (
        isAbsolute(input) ||
        input.startsWith('./') ||
        input.startsWith('../') ||
        input === '.' ||
        input === '..' ||
        // Windows absolute paths like C:\ or D:\
        /^[a-zA-Z]:[/\\]/.test(input)
    );
}

/**
 * Parse a source string into a structured format
 * Supports: local paths, GitHub URLs, GitLab URLs, GitHub shorthand, and direct git URLs
 */
export function parseSource(input: string): ParsedSource {
    // Local path: absolute, relative, or current directory
    if (isLocalPath(input)) {
        const resolvedPath = resolve(input);
        // Return local type even if path doesn't exist - we'll handle validation in main flow
        return {
            type: 'local',
            url: resolvedPath, // Store resolved path in url for consistency
            localPath: resolvedPath,
        };
    }

    // GitHub URL with path: https://github.com/owner/repo/tree/branch/path/to/skill
    const githubTreeWithPathMatch = input.match(
        /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/
    );
    if (githubTreeWithPathMatch) {
        const [, owner, repo, ref, subpath] = githubTreeWithPathMatch;
        return {
            type: 'github',
            url: `https://github.com/${owner}/${repo}.git`,
            ref,
            subpath,
        };
    }

    // GitHub URL with branch only: https://github.com/owner/repo/tree/branch
    const githubTreeMatch = input.match(
        /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)$/
    );
    if (githubTreeMatch) {
        const [, owner, repo, ref] = githubTreeMatch;
        return {
            type: 'github',
            url: `https://github.com/${owner}/${repo}.git`,
            ref,
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
    const gitlabTreeWithPathMatch = input.match(
        /gitlab\.com\/([^/]+)\/([^/]+)\/-\/tree\/([^/]+)\/(.+)/
    );
    if (gitlabTreeWithPathMatch) {
        const [, owner, repo, ref, subpath] = gitlabTreeWithPathMatch;
        return {
            type: 'gitlab',
            url: `https://gitlab.com/${owner}/${repo}.git`,
            ref,
            subpath,
        };
    }

    // GitLab URL with branch only: https://gitlab.com/owner/repo/-/tree/branch
    const gitlabTreeMatch = input.match(
        /gitlab\.com\/([^/]+)\/([^/]+)\/-\/tree\/([^/]+)$/
    );
    if (gitlabTreeMatch) {
        const [, owner, repo, ref] = gitlabTreeMatch;
        return {
            type: 'gitlab',
            url: `https://gitlab.com/${owner}/${repo}.git`,
            ref,
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
    // Exclude paths that start with . or / to avoid matching local paths
    const shorthandMatch = input.match(/^([^/]+)\/([^/]+)(?:\/(.+))?$/);
    if (shorthandMatch && !input.includes(':') && !input.startsWith('.') && !input.startsWith('/')) {
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
