export type AgentType = 'opencode' | 'claude-code' | 'codex' | 'cursor';

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
  type: 'github' | 'gitlab' | 'git';
  url: string;
  subpath?: string;
}

export type CustomGlobalDirs = Partial<Record<AgentType, string>>;
