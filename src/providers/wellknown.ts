import matter from 'gray-matter';
import type { HostProvider, ProviderMatch, RemoteSkill } from './types.js';

/**
 * Represents the index.json structure for well-known skills.
 */
export interface WellKnownIndex {
  skills: WellKnownSkillEntry[];
}

/**
 * Represents a skill entry in the index.json.
 */
export interface WellKnownSkillEntry {
  /** Skill identifier. Must match the directory name. */
  name: string;
  /** Brief description of what the skill does. */
  description: string;
  /** Array of all files in the skill directory. */
  files: string[];
}

/**
 * Represents a skill with all its files fetched from a well-known endpoint.
 */
export interface WellKnownSkill extends RemoteSkill {
  /** All files in the skill, keyed by relative path */
  files: Map<string, string>;
  /** The entry from the index.json */
  indexEntry: WellKnownSkillEntry;
}

/**
 * Well-known skills provider using RFC 8615 well-known URIs.
 *
 * Organizations can publish skills at:
 * https://example.com/.well-known/skills/
 *
 * URL formats supported:
 * - https://example.com (discovers all skills from root)
 * - https://example.com/docs (discovers from /docs/.well-known/skills/)
 * - https://example.com/.well-known/skills (discovers all skills)
 * - https://example.com/.well-known/skills/skill-name (specific skill)
 *
 * The source identifier is "wellknown/{hostname}" or "wellknown/{hostname}/path".
 */
export class WellKnownProvider implements HostProvider {
  readonly id = 'well-known';
  readonly displayName = 'Well-Known Skills';

  private readonly WELL_KNOWN_PATH = '.well-known/skills';
  private readonly INDEX_FILE = 'index.json';

  /**
   * Check if a URL could be a well-known skills endpoint.
   * This is a fallback provider - it matches any HTTP(S) URL that is not
   * a recognized pattern (GitHub, GitLab, owner/repo shorthand, etc.)
   */
  match(url: string): ProviderMatch {
    // Must be a valid HTTP(S) URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { matches: false };
    }

    // Parse URL to extract hostname
    try {
      const parsed = new URL(url);

      // Exclude known git hosts that have their own handling
      const excludedHosts = ['github.com', 'gitlab.com', 'huggingface.co'];
      if (excludedHosts.includes(parsed.hostname)) {
        return { matches: false };
      }

      return {
        matches: true,
        sourceIdentifier: `wellknown/${parsed.hostname}`,
      };
    } catch {
      return { matches: false };
    }
  }

  /**
   * Fetch the skills index from a well-known endpoint.
   * Tries both the path-relative .well-known and the root .well-known.
   */
  async fetchIndex(
    baseUrl: string
  ): Promise<{ index: WellKnownIndex; resolvedBaseUrl: string } | null> {
    try {
      const parsed = new URL(baseUrl);
      const basePath = parsed.pathname.replace(/\/$/, ''); // Remove trailing slash

      // Try path-relative .well-known first (e.g., /docs/.well-known/skills/)
      // then fall back to root .well-known
      const urlsToTry = [
        // Path-relative: https://example.com/docs/.well-known/skills/index.json
        {
          indexUrl: `${parsed.protocol}//${parsed.hostname}${basePath}/${this.WELL_KNOWN_PATH}/${this.INDEX_FILE}`,
          baseUrl: `${parsed.protocol}//${parsed.hostname}${basePath}`,
        },
      ];

      // Also try root if we have a path
      if (basePath && basePath !== '') {
        urlsToTry.push({
          indexUrl: `${parsed.protocol}//${parsed.hostname}/${this.WELL_KNOWN_PATH}/${this.INDEX_FILE}`,
          baseUrl: `${parsed.protocol}//${parsed.hostname}`,
        });
      }

      for (const { indexUrl, baseUrl: resolvedBase } of urlsToTry) {
        try {
          const response = await fetch(indexUrl);

          if (!response.ok) {
            continue;
          }

          const index = (await response.json()) as WellKnownIndex;

          // Validate index structure
          if (!index.skills || !Array.isArray(index.skills)) {
            continue;
          }

          // Validate each skill entry
          let allValid = true;
          for (const entry of index.skills) {
            if (!this.isValidSkillEntry(entry)) {
              allValid = false;
              break;
            }
          }

          if (allValid) {
            return { index, resolvedBaseUrl: resolvedBase };
          }
        } catch {
          // Try next URL
          continue;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Validate a skill entry from the index.
   */
  private isValidSkillEntry(entry: unknown): entry is WellKnownSkillEntry {
    if (!entry || typeof entry !== 'object') return false;

    const e = entry as Record<string, unknown>;

    // Required fields
    if (typeof e.name !== 'string' || !e.name) return false;
    if (typeof e.description !== 'string' || !e.description) return false;
    if (!Array.isArray(e.files) || e.files.length === 0) return false;

    // Validate name format (per spec: 1-64 chars, lowercase alphanumeric and hyphens)
    const nameRegex = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
    if (!nameRegex.test(e.name) && e.name.length > 1) {
      // Allow single char names like "a"
      if (e.name.length === 1 && !/^[a-z0-9]$/.test(e.name)) {
        return false;
      }
    }

    // Validate files array
    for (const file of e.files) {
      if (typeof file !== 'string') return false;
      // Files must not start with / or contain ..
      if (file.startsWith('/') || file.includes('..')) return false;
    }

    // Must include SKILL.md
    const hasSkillMd = e.files.some((f) => typeof f === 'string' && f.toLowerCase() === 'skill.md');
    if (!hasSkillMd) return false;

    return true;
  }

  /**
   * Fetch a single skill and all its files from a well-known endpoint.
   */
  async fetchSkill(url: string): Promise<RemoteSkill | null> {
    try {
      const parsed = new URL(url);

      // First, fetch the index to get skill metadata
      const result = await this.fetchIndex(url);
      if (!result) {
        return null;
      }

      const { index, resolvedBaseUrl } = result;

      // Determine which skill to fetch
      let skillName: string | null = null;

      // Check if URL specifies a specific skill
      const pathMatch = parsed.pathname.match(/\/.well-known\/skills\/([^/]+)\/?$/);
      if (pathMatch && pathMatch[1] && pathMatch[1] !== 'index.json') {
        skillName = pathMatch[1];
      } else if (index.skills.length === 1) {
        // If only one skill in index, use that
        skillName = index.skills[0]!.name;
      }

      if (!skillName) {
        // Multiple skills available, return null - caller should use fetchAllSkills
        return null;
      }

      // Find the skill in the index
      const skillEntry = index.skills.find((s: WellKnownSkillEntry) => s.name === skillName);
      if (!skillEntry) {
        return null;
      }

      return this.fetchSkillByEntry(resolvedBaseUrl, skillEntry);
    } catch {
      return null;
    }
  }

  /**
   * Fetch a skill by its index entry.
   * @param baseUrl - The base URL (e.g., https://example.com or https://example.com/docs)
   * @param entry - The skill entry from index.json
   */
  async fetchSkillByEntry(
    baseUrl: string,
    entry: WellKnownSkillEntry
  ): Promise<WellKnownSkill | null> {
    try {
      // Build the skill base URL: {baseUrl}/.well-known/skills/{skill-name}
      const skillBaseUrl = `${baseUrl.replace(/\/$/, '')}/${this.WELL_KNOWN_PATH}/${entry.name}`;

      // Fetch SKILL.md first (required)
      const skillMdUrl = `${skillBaseUrl}/SKILL.md`;
      const response = await fetch(skillMdUrl);

      if (!response.ok) {
        return null;
      }

      const content = await response.text();
      const { data } = matter(content);

      // Validate frontmatter has name and description
      if (!data.name || !data.description) {
        return null;
      }

      // Fetch all other files
      const files = new Map<string, string>();
      files.set('SKILL.md', content);

      // Fetch remaining files in parallel
      const otherFiles = entry.files.filter((f) => f.toLowerCase() !== 'skill.md');
      const filePromises = otherFiles.map(async (filePath) => {
        try {
          const fileUrl = `${skillBaseUrl}/${filePath}`;
          const fileResponse = await fetch(fileUrl);
          if (fileResponse.ok) {
            const fileContent = await fileResponse.text();
            return { path: filePath, content: fileContent };
          }
        } catch {
          // Ignore individual file fetch errors
        }
        return null;
      });

      const fileResults = await Promise.all(filePromises);
      for (const result of fileResults) {
        if (result) {
          files.set(result.path, result.content);
        }
      }

      return {
        name: data.name,
        description: data.description,
        content,
        installName: entry.name,
        sourceUrl: skillMdUrl,
        metadata: data.metadata,
        files,
        indexEntry: entry,
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch all skills from a well-known endpoint.
   */
  async fetchAllSkills(url: string): Promise<WellKnownSkill[]> {
    try {
      const result = await this.fetchIndex(url);
      if (!result) {
        return [];
      }

      const { index, resolvedBaseUrl } = result;

      // Fetch all skills in parallel
      const skillPromises = index.skills.map((entry: WellKnownSkillEntry) =>
        this.fetchSkillByEntry(resolvedBaseUrl, entry)
      );
      const results = await Promise.all(skillPromises);

      return results.filter((s: WellKnownSkill | null): s is WellKnownSkill => s !== null);
    } catch {
      return [];
    }
  }

  /**
   * Convert a user-facing URL to a skill URL.
   * For well-known, this extracts the base domain and constructs the proper path.
   */
  toRawUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // If already pointing to a SKILL.md, return as-is
      if (url.toLowerCase().endsWith('/skill.md')) {
        return url;
      }

      // Check if URL specifies a skill path
      const pathMatch = parsed.pathname.match(/\/.well-known\/skills\/([^/]+)\/?$/);
      if (pathMatch && pathMatch[1]) {
        const basePath = parsed.pathname.replace(/\/.well-known\/skills\/.*$/, '');
        return `${parsed.protocol}//${parsed.hostname}${basePath}/${this.WELL_KNOWN_PATH}/${pathMatch[1]}/SKILL.md`;
      }

      // Otherwise, return the index URL
      const basePath = parsed.pathname.replace(/\/$/, '');
      return `${parsed.protocol}//${parsed.hostname}${basePath}/${this.WELL_KNOWN_PATH}/${this.INDEX_FILE}`;
    } catch {
      return url;
    }
  }

  /**
   * Get the source identifier for telemetry/storage.
   * Returns the domain in owner/repo format: second-level-domain/top-level-domain.
   * e.g., "mintlify.com" → "mintlify/com", "lovable.dev" → "lovable/dev"
   * This matches the owner/repo pattern used by GitHub sources for consistency in the leaderboard.
   */
  getSourceIdentifier(url: string): string {
    try {
      const parsed = new URL(url);
      // Extract the main domain (ignore subdomains like "docs." or "api.")
      const hostParts = parsed.hostname.split('.');

      // Handle common cases:
      // - example.com → example/com
      // - docs.example.com → example/com (strip subdomain)
      // - example.co.uk → example/co.uk (keep compound TLD)

      if (hostParts.length >= 2) {
        // Get the last two parts as the main domain
        const tld = hostParts[hostParts.length - 1]; // com, dev, io, etc.
        const sld = hostParts[hostParts.length - 2]; // mintlify, lovable, etc.
        return `${sld}/${tld}`;
      }

      // Fallback for unusual hostnames
      return parsed.hostname.replace('.', '/');
    } catch {
      return 'unknown/unknown';
    }
  }

  /**
   * Check if a URL has a well-known skills index.
   */
  async hasSkillsIndex(url: string): Promise<boolean> {
    const result = await this.fetchIndex(url);
    return result !== null;
  }
}

export const wellKnownProvider = new WellKnownProvider();
