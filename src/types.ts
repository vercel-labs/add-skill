export type AgentType = 'opencode' | 'claude-code' | 'codex' | 'cursor' | 'amp' | 'kilo' | 'roo' | 'goose' | 'antigravity' | 'gemini-cli' | 'github-copilot' | 'clawdbot' | 'droid' | 'gemini' | 'windsurf';

export interface Skill {
  name: string;
  description: string;
  path: string;
  metadata?: Record<string, string>;
}

export interface AgentConfig {
  name: string;
  displayName: string;
  skillsDir: string;
  globalSkillsDir: string;
  detectInstalled: () => Promise<boolean>;
}

export interface ParsedSource {
  type: 'github' | 'gitlab' | 'git' | 'local';
  url: string;
  subpath?: string;
  localPath?: string;
}
