import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import type { AgentConfig, AgentType, CustomGlobalDirs } from './types.js';

const home = homedir();

export const agents: Record<AgentType, AgentConfig> = {
  opencode: {
    name: 'opencode',
    displayName: 'OpenCode',
    skillsDir: '.opencode/skill',
    globalSkillsDir: join(home, '.config/opencode/skill'),
    detectInstalled: async () => {
      return existsSync(join(home, '.config/opencode')) || existsSync(join(home, '.claude/skills'));
    },
  },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    skillsDir: '.claude/skills',
    globalSkillsDir: join(home, '.claude/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.claude'));
    },
  },
  codex: {
    name: 'codex',
    displayName: 'Codex',
    skillsDir: '.codex/skills',
    globalSkillsDir: join(home, '.codex/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.codex'));
    },
  },
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    skillsDir: '.cursor/skills',
    globalSkillsDir: join(home, '.cursor/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.cursor'));
    },
  },
};

export async function detectInstalledAgents(): Promise<AgentType[]> {
  const installed: AgentType[] = [];

  for (const [type, config] of Object.entries(agents)) {
    if (await config.detectInstalled()) {
      installed.push(type as AgentType);
    }
  }

  return installed;
}

export function getAgentConfig(type: AgentType, customDirs?: CustomGlobalDirs): AgentConfig {
  const config = agents[type];
  if (customDirs?.[type]) {
    return { ...config, globalSkillsDir: customDirs[type] };
  }
  return config;
}
