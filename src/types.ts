export type AgentType =
  | 'amp'
  | 'antigravity'
  | 'claude-code'
  | 'moltbot'
  | 'cline'
  | 'codebuddy'
  | 'codex'
  | 'command-code'
  | 'continue'
  | 'crush'
  | 'cursor'
  | 'droid'
  | 'gemini-cli'
  | 'github-copilot'
  | 'goose'
  | 'junie'
  | 'kilo'
  | 'kimi-cli'
  | 'kiro-cli'
  | 'kode'
  | 'mcpjam'
  | 'mux'
  | 'neovate'
  | 'opencode'
  | 'openhands'
  | 'pi'
  | 'qoder'
  | 'qwen-code'
  | 'roo'
  | 'trae'
  | 'windsurf'
  | 'zencoder'
  | 'pochi';

export interface Skill {
  name: string;
  description: string;
  path: string;
  /** Raw SKILL.md content for hashing */
  rawContent?: string;
  metadata?: Record<string, unknown>;
  /** Auth configuration for private skills */
  authConfig?: SkillAuthConfig;
}

export interface AgentConfig {
  name: string;
  displayName: string;
  skillsDir: string;
  globalSkillsDir: string;
  detectInstalled: () => Promise<boolean>;
}

export interface ParsedSource {
  type: 'github' | 'gitlab' | 'git' | 'local' | 'direct-url' | 'well-known';
  url: string;
  subpath?: string;
  localPath?: string;
  ref?: string;
  /** Skill name extracted from @skill syntax (e.g., owner/repo@skill-name) */
  skillFilter?: string;
}

export interface MintlifySkill {
  name: string;
  description: string;
  content: string;
  mintlifySite: string;
  sourceUrl: string;
}

/**
 * Represents a skill fetched from a remote host provider.
 */
/**
 * Endpoint configuration for auth requests.
 */
export interface AuthEndpointConfig {
  /** The endpoint URL to call */
  endpoint: string;
  /** HTTP method to use */
  method: 'GET' | 'POST';
  /** Header name for the license token */
  tokenHeader: string;
  /** Prefix to add before the token (e.g., "Bearer ") */
  tokenPrefix: string;
}

/**
 * Configuration for private skill authentication.
 * Stored in SKILL.auth.json alongside SKILL.md.
 */
export interface SkillAuthConfig {
  /** Endpoint for verifying license validity */
  verify: AuthEndpointConfig;
  /** Endpoint for fetching protected skill content (required for gated skills) */
  content?: AuthEndpointConfig;
}

/**
 * Result of license verification from the skill author's endpoint.
 */
export interface LicenseVerificationResult {
  /** Whether the license is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** ISO timestamp when the license expires */
  expiresAt?: string;
}

export interface RemoteSkill {
  /** Display name of the skill (from frontmatter) */
  name: string;
  /** Description of the skill (from frontmatter) */
  description: string;
  /** Full markdown content including frontmatter */
  content: string;
  /** The identifier used for installation directory name */
  installName: string;
  /** The original source URL */
  sourceUrl: string;
  /** The provider that fetched this skill */
  providerId: string;
  /** Source identifier for telemetry (e.g., "mintlify/bun.com") */
  sourceIdentifier: string;
  /** Any additional metadata from frontmatter */
  metadata?: Record<string, unknown>;
  /** Auth configuration for private skills */
  authConfig?: SkillAuthConfig;
}
