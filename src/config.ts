import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AgentType } from './types.ts';

const CONFIG_DIR = '.skills-cli';
const CONFIG_FILE = 'config.json';

export interface AgentConfigOverride {
  globalSkillsDir?: string;
  skillsDir?: string;
}

export interface SkillsConfig {
  canonicalDir?: {
    global?: string;
    project?: string;
  };
  agents?: Partial<Record<AgentType, AgentConfigOverride>>;
}

let cachedConfig: SkillsConfig | null = null;

/**
 * Gets the path to the config file
 */
export function getConfigPath(): string {
  return join(homedir(), CONFIG_DIR, CONFIG_FILE);
}

/**
 * Gets the path to the config directory
 */
export function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR);
}

/**
 * Loads config from disk, returns empty config if file doesn't exist
 */
export function loadConfig(): SkillsConfig {
  const configPath = getConfigPath();
  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as SkillsConfig;
  } catch {
    return {};
  }
}

/**
 * Saves config to disk
 */
export function saveConfig(config: SkillsConfig): void {
  const configPath = getConfigPath();
  const configDir = getConfigDir();

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  // Invalidate cache
  cachedConfig = null;
}

/**
 * Gets the config (cached singleton)
 */
export function getConfig(): SkillsConfig {
  if (cachedConfig === null) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * Clears the config cache (useful for testing)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Sets a nested config value using dot notation
 * @param key - Dot-notated key (e.g., "agents.claude-code.globalSkillsDir")
 * @param value - Value to set
 */
export function setConfigValue(key: string, value: string): void {
  const config = loadConfig();
  const parts = key.split('.');

  let current: Record<string, unknown> = config as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1]!;
  current[lastPart] = value;

  saveConfig(config);
}

/**
 * Gets a nested config value using dot notation
 * @param key - Dot-notated key (e.g., "agents.claude-code.globalSkillsDir")
 * @returns The value or undefined if not found
 */
export function getConfigValue(key: string): unknown {
  const config = getConfig();
  const parts = key.split('.');

  let current: unknown = config;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
