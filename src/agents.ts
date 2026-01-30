import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { xdgConfig } from 'xdg-basedir';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { AgentConfig, AgentType } from './types.ts';

const execAsync = promisify(exec);

/**
 * Check if a command exists in PATH (cross-platform)
 * Uses 'which' on Unix/macOS and 'where' on Windows
 */
async function commandExists(binName: string): Promise<boolean> {
  try {
    const command = process.platform === 'win32' ? 'where' : 'command -v';
    await execAsync(`${command} ${binName}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create isValidInstalled that reads binName from config automatically
 * - If binName exists (string): checks if binary is in PATH
 * - If binName is null (IDE-only) or undefined: falls back to detectInstalled
 */
function createIsValidInstalled(): (config: AgentConfig) => Promise<boolean> {
  return async (config: AgentConfig) => {
    const binName = config.binName;
    // IDE-only agents (null) or unknown binary (undefined) use detectInstalled
    if (binName === null || binName === undefined) {
      return config.detectInstalled();
    }
    // CLI agents check if binary exists
    return commandExists(binName);
  };
}

const home = homedir();
// Use xdg-basedir (not env-paths) to match OpenCode/Amp/Goose behavior on all platforms.
const configHome = xdgConfig ?? join(home, '.config');
const codexHome = process.env.CODEX_HOME?.trim() || join(home, '.codex');
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');

// Shared isValidInstalled function for all agents
const isValidInstalledFn = createIsValidInstalled();

export const agents: Record<AgentType, AgentConfig> = {
  amp: {
    name: 'amp',
    displayName: 'Amp',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'agents/skills'),
    binName: 'amp',
    detectInstalled: async () => existsSync(join(configHome, 'amp')),
    isValidInstalled: isValidInstalledFn,
  },
  antigravity: {
    name: 'antigravity',
    displayName: 'Antigravity',
    skillsDir: '.agent/skills',
    globalSkillsDir: join(home, '.gemini/antigravity/global_skills'),
    binName: null, // Google Antigravity is IDE-only, no CLI
    detectInstalled: async () =>
      existsSync(join(process.cwd(), '.agent')) || existsSync(join(home, '.gemini/antigravity')),
    isValidInstalled: isValidInstalledFn,
  },
  augment: {
    name: 'augment',
    displayName: 'Augment',
    skillsDir: '.augment/rules',
    globalSkillsDir: join(home, '.augment/rules'),
    binName: 'auggie',
    detectInstalled: async () => existsSync(join(home, '.augment')),
    isValidInstalled: isValidInstalledFn,
  },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    skillsDir: '.claude/skills',
    globalSkillsDir: join(claudeHome, 'skills'),
    binName: 'claude',
    detectInstalled: async () => existsSync(claudeHome),
    isValidInstalled: isValidInstalledFn,
  },
  openclaw: {
    name: 'openclaw',
    displayName: 'OpenClaw',
    skillsDir: 'skills',
    globalSkillsDir: existsSync(join(home, '.openclaw'))
      ? join(home, '.openclaw/skills')
      : existsSync(join(home, '.clawdbot'))
        ? join(home, '.clawdbot/skills')
        : join(home, '.moltbot/skills'),
    binName: 'openclaw',
    detectInstalled: async () =>
      existsSync(join(home, '.openclaw')) ||
      existsSync(join(home, '.clawdbot')) ||
      existsSync(join(home, '.moltbot')),
    isValidInstalled: isValidInstalledFn,
  },
  cline: {
    name: 'cline',
    displayName: 'Cline',
    skillsDir: '.cline/skills',
    globalSkillsDir: join(home, '.cline/skills'),
    binName: 'cline',
    detectInstalled: async () => existsSync(join(home, '.cline')),
    isValidInstalled: isValidInstalledFn,
  },
  codebuddy: {
    name: 'codebuddy',
    displayName: 'CodeBuddy',
    skillsDir: '.codebuddy/skills',
    globalSkillsDir: join(home, '.codebuddy/skills'),
    binName: 'codebuddy',
    detectInstalled: async () =>
      existsSync(join(process.cwd(), '.codebuddy')) || existsSync(join(home, '.codebuddy')),
    isValidInstalled: isValidInstalledFn,
  },
  codex: {
    name: 'codex',
    displayName: 'Codex',
    skillsDir: '.codex/skills',
    globalSkillsDir: join(codexHome, 'skills'),
    binName: 'codex',
    detectInstalled: async () => existsSync(codexHome) || existsSync('/etc/codex'),
    isValidInstalled: isValidInstalledFn,
  },
  'command-code': {
    name: 'command-code',
    displayName: 'Command Code',
    skillsDir: '.commandcode/skills',
    globalSkillsDir: join(home, '.commandcode/skills'),
    binName: 'cmd',
    detectInstalled: async () => existsSync(join(home, '.commandcode')),
    isValidInstalled: isValidInstalledFn,
  },
  continue: {
    name: 'continue',
    displayName: 'Continue',
    skillsDir: '.continue/skills',
    globalSkillsDir: join(home, '.continue/skills'),
    binName: 'cn',
    detectInstalled: async () =>
      existsSync(join(process.cwd(), '.continue')) || existsSync(join(home, '.continue')),
    isValidInstalled: isValidInstalledFn,
  },
  crush: {
    name: 'crush',
    displayName: 'Crush',
    skillsDir: '.crush/skills',
    globalSkillsDir: join(home, '.config/crush/skills'),
    binName: 'crush',
    detectInstalled: async () => existsSync(join(home, '.config/crush')),
    isValidInstalled: isValidInstalledFn,
  },
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    skillsDir: '.cursor/skills',
    globalSkillsDir: join(home, '.cursor/skills'),
    binName: 'cursor',
    detectInstalled: async () => existsSync(join(home, '.cursor')),
    isValidInstalled: isValidInstalledFn,
  },
  droid: {
    name: 'droid',
    displayName: 'Droid',
    skillsDir: '.factory/skills',
    globalSkillsDir: join(home, '.factory/skills'),
    binName: 'droid',
    detectInstalled: async () => existsSync(join(home, '.factory')),
    isValidInstalled: isValidInstalledFn,
  },
  'gemini-cli': {
    name: 'gemini-cli',
    displayName: 'Gemini CLI',
    skillsDir: '.gemini/skills',
    globalSkillsDir: join(home, '.gemini/skills'),
    binName: 'gemini',
    detectInstalled: async () => existsSync(join(home, '.gemini')),
    isValidInstalled: isValidInstalledFn,
  },
  'github-copilot': {
    name: 'github-copilot',
    displayName: 'GitHub Copilot',
    skillsDir: '.github/skills',
    globalSkillsDir: join(home, '.copilot/skills'),
    binName: null, // bin name code, use vscode to run, ignore it fallback to detectInstalled
    detectInstalled: async () =>
      existsSync(join(process.cwd(), '.github')) || existsSync(join(home, '.copilot')),
    isValidInstalled: isValidInstalledFn,
  },
  goose: {
    name: 'goose',
    displayName: 'Goose',
    skillsDir: '.goose/skills',
    globalSkillsDir: join(configHome, 'goose/skills'),
    binName: 'goose',
    detectInstalled: async () => existsSync(join(configHome, 'goose')),
    isValidInstalled: isValidInstalledFn,
  },
  junie: {
    name: 'junie',
    displayName: 'Junie',
    skillsDir: '.junie/skills',
    globalSkillsDir: join(home, '.junie/skills'),
    binName: null, // Junie is JetBrains IDE-only, no CLI
    detectInstalled: async () => existsSync(join(home, '.junie')),
    isValidInstalled: isValidInstalledFn,
  },
  'iflow-cli': {
    name: 'iflow-cli',
    displayName: 'iFlow CLI',
    skillsDir: '.iflow/skills',
    globalSkillsDir: join(home, '.iflow/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.iflow'));
    },
  },
  kilo: {
    name: 'kilo',
    displayName: 'Kilo Code',
    skillsDir: '.kilocode/skills',
    globalSkillsDir: join(home, '.kilocode/skills'),
    binName: 'kilocode',
    detectInstalled: async () => existsSync(join(home, '.kilocode')),
    isValidInstalled: isValidInstalledFn,
  },
  'kimi-cli': {
    name: 'kimi-cli',
    displayName: 'Kimi Code CLI',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.config/agents/skills'),
    binName: 'kimi',
    detectInstalled: async () => existsSync(join(home, '.kimi')),
    isValidInstalled: isValidInstalledFn,
  },
  'kiro-cli': {
    name: 'kiro-cli',
    displayName: 'Kiro CLI',
    skillsDir: '.kiro/skills',
    globalSkillsDir: join(home, '.kiro/skills'),
    binName: 'kiro',
    detectInstalled: async () => existsSync(join(home, '.kiro')),
    isValidInstalled: isValidInstalledFn,
  },
  kode: {
    name: 'kode',
    displayName: 'Kode',
    skillsDir: '.kode/skills',
    globalSkillsDir: join(home, '.kode/skills'),
    binName: 'kode',
    detectInstalled: async () => existsSync(join(home, '.kode')),
    isValidInstalled: isValidInstalledFn,
  },
  mcpjam: {
    name: 'mcpjam',
    displayName: 'MCPJam',
    skillsDir: '.mcpjam/skills',
    globalSkillsDir: join(home, '.mcpjam/skills'),
    binName: 'mcpjam',
    detectInstalled: async () => existsSync(join(home, '.mcpjam')),
    isValidInstalled: isValidInstalledFn,
  },
  'mistral-vibe': {
    name: 'mistral-vibe',
    displayName: 'Mistral Vibe',
    skillsDir: '.vibe/skills',
    globalSkillsDir: join(home, '.vibe/skills'),
    binName: 'vibe',
    detectInstalled: async () => existsSync(join(home, '.vibe')),
    isValidInstalled: isValidInstalledFn,
  },
  mux: {
    name: 'mux',
    displayName: 'Mux',
    skillsDir: '.mux/skills',
    globalSkillsDir: join(home, '.mux/skills'),
    binName: 'mux',
    detectInstalled: async () => existsSync(join(home, '.mux')),
    isValidInstalled: isValidInstalledFn,
  },
  opencode: {
    name: 'opencode',
    displayName: 'OpenCode',
    skillsDir: '.opencode/skills',
    globalSkillsDir: join(configHome, 'opencode/skills'),
    binName: 'opencode',
    detectInstalled: async () =>
      existsSync(join(configHome, 'opencode')) || existsSync(join(claudeHome, 'skills')),
    isValidInstalled: isValidInstalledFn,
  },
  openclaude: {
    name: 'openclaude',
    displayName: 'OpenClaude IDE',
    skillsDir: '.openclaude/skills',
    globalSkillsDir: join(home, '.openclaude/skills'),
    binName: 'openclaude',
    detectInstalled: async () =>
      existsSync(join(home, '.openclaude')) || existsSync(join(process.cwd(), '.openclaude')),
    isValidInstalled: isValidInstalledFn,
  },
  openhands: {
    name: 'openhands',
    displayName: 'OpenHands',
    skillsDir: '.openhands/skills',
    globalSkillsDir: join(home, '.openhands/skills'),
    binName: 'openhands',
    detectInstalled: async () => existsSync(join(home, '.openhands')),
    isValidInstalled: isValidInstalledFn,
  },
  pi: {
    name: 'pi',
    displayName: 'Pi',
    skillsDir: '.pi/skills',
    globalSkillsDir: join(home, '.pi/agent/skills'),
    binName: 'pi',
    detectInstalled: async () => existsSync(join(home, '.pi/agent')),
    isValidInstalled: isValidInstalledFn,
  },
  qoder: {
    name: 'qoder',
    displayName: 'Qoder',
    skillsDir: '.qoder/skills',
    globalSkillsDir: join(home, '.qoder/skills'),
    binName: 'qoder',
    detectInstalled: async () => existsSync(join(home, '.qoder')),
    isValidInstalled: isValidInstalledFn,
  },
  'qwen-code': {
    name: 'qwen-code',
    displayName: 'Qwen Code',
    skillsDir: '.qwen/skills',
    globalSkillsDir: join(home, '.qwen/skills'),
    binName: 'qwen',
    detectInstalled: async () => existsSync(join(home, '.qwen')),
    isValidInstalled: isValidInstalledFn,
  },
  replit: {
    name: 'replit',
    displayName: 'Replit',
    skillsDir: '.agent/skills',
    globalSkillsDir: undefined,
    binName: null, // Replit is cloud IDE only, no CLI
    detectInstalled: async () => existsSync(join(process.cwd(), '.agent')),
    isValidInstalled: isValidInstalledFn,
  },
  roo: {
    name: 'roo',
    displayName: 'Roo Code',
    skillsDir: '.roo/skills',
    globalSkillsDir: join(home, '.roo/skills'),
    binName: 'roo',
    detectInstalled: async () => existsSync(join(home, '.roo')),
    isValidInstalled: isValidInstalledFn,
  },
  trae: {
    name: 'trae',
    displayName: 'Trae',
    skillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae/skills'),
    binName: null, // different cn or en use same bin name, ignore it fallback to detectInstalled
    detectInstalled: async () => existsSync(join(home, '.trae')),
    isValidInstalled: isValidInstalledFn,
  },
  'trae-cn': {
    name: 'trae-cn',
    displayName: 'Trae CN',
    skillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae-cn/skills'),
    binName: null,
    detectInstalled: async () => existsSync(join(home, '.trae-cn')),
    isValidInstalled: isValidInstalledFn,
  },
  windsurf: {
    name: 'windsurf',
    displayName: 'Windsurf',
    skillsDir: '.windsurf/skills',
    globalSkillsDir: join(home, '.codeium/windsurf/skills'),
    binName: 'windsurf',
    detectInstalled: async () => existsSync(join(home, '.codeium/windsurf')),
    isValidInstalled: isValidInstalledFn,
  },
  zencoder: {
    name: 'zencoder',
    displayName: 'Zencoder',
    skillsDir: '.zencoder/skills',
    globalSkillsDir: join(home, '.zencoder/skills'),
    binName: null,
    detectInstalled: async () => existsSync(join(home, '.zencoder')),
    isValidInstalled: isValidInstalledFn,
  },
  neovate: {
    name: 'neovate',
    displayName: 'Neovate',
    skillsDir: '.neovate/skills',
    globalSkillsDir: join(home, '.neovate/skills'),
    binName: 'neovate',
    detectInstalled: async () => existsSync(join(home, '.neovate')),
    isValidInstalled: isValidInstalledFn,
  },
  pochi: {
    name: 'pochi',
    displayName: 'Pochi',
    skillsDir: '.pochi/skills',
    globalSkillsDir: join(home, '.pochi/skills'),
    binName: 'pochi',
    detectInstalled: async () => existsSync(join(home, '.pochi')),
    isValidInstalled: isValidInstalledFn,
  },
  adal: {
    name: 'adal',
    displayName: 'AdaL',
    skillsDir: '.adal/skills',
    globalSkillsDir: join(home, '.adal/skills'),
    binName: 'adal',
    detectInstalled: async () => existsSync(join(home, '.adal')),
    isValidInstalled: isValidInstalledFn,
  },
};

export async function detectInstalledAgents(): Promise<AgentType[]> {
  const results = await Promise.all(
    Object.entries(agents).map(async ([type, config]) => ({
      type: type as AgentType,
      installed: await config.detectInstalled(),
    }))
  );
  return results.filter((r) => r.installed).map((r) => r.type);
}

/**
 * Detect agents that are validly installed (binary exists, or detectInstalled for IDE-only)
 * This should be used for "All detected" selection
 */
export async function detectValidInstalledAgents(): Promise<AgentType[]> {
  const results = await Promise.all(
    Object.entries(agents).map(async ([type, config]) => ({
      type: type as AgentType,
      installed: await config.isValidInstalled(config),
    }))
  );
  return results.filter((r) => r.installed).map((r) => r.type);
}

export function getAgentConfig(type: AgentType): AgentConfig {
  return agents[type];
}
