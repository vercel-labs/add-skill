import { existsSync } from 'fs';
import {
  getConfigPath,
  getConfig,
  saveConfig,
  setConfigValue,
  getConfigValue,
  type SkillsConfig,
} from './config.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';

function showConfigHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} skills config [options]

${BOLD}Options:${RESET}
  --show, -s       Show current configuration (default)
  --path, -p       Show config file path
  --init, -i       Create default config file

${BOLD}Subcommands:${RESET}
  set <key> <value>   Set a configuration value

${BOLD}Configuration Keys:${RESET}
  canonicalDir.global              Custom global canonical skills directory
  canonicalDir.project             Custom project canonical skills directory (relative)
  agents.<agent>.globalSkillsDir   Custom global skills dir for an agent
  agents.<agent>.skillsDir         Custom project skills dir for an agent (relative)

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} skills config                              ${DIM}# show current config${RESET}
  ${DIM}$${RESET} skills config --path                       ${DIM}# show config file path${RESET}
  ${DIM}$${RESET} skills config --init                       ${DIM}# create default config${RESET}
  ${DIM}$${RESET} skills config set canonicalDir.global /custom/path
  ${DIM}$${RESET} skills config set agents.claude-code.globalSkillsDir /my/skills
`);
}

function showConfig(): void {
  const configPath = getConfigPath();
  const config = getConfig();

  if (!existsSync(configPath)) {
    console.log(`${DIM}No config file found at ${configPath}${RESET}`);
    console.log(
      `${DIM}Run${RESET} ${TEXT}skills config --init${RESET} ${DIM}to create one${RESET}`
    );
    return;
  }

  console.log(`${TEXT}Config file:${RESET} ${configPath}`);
  console.log();

  if (Object.keys(config).length === 0) {
    console.log(`${DIM}(empty config)${RESET}`);
    return;
  }

  console.log(JSON.stringify(config, null, 2));
}

function showPath(): void {
  const configPath = getConfigPath();
  console.log(configPath);
}

function initConfig(): void {
  const configPath = getConfigPath();

  if (existsSync(configPath)) {
    console.log(`${TEXT}Config file already exists at ${configPath}${RESET}`);
    return;
  }

  const defaultConfig: SkillsConfig = {
    canonicalDir: {
      // global: "/custom/path/to/skills",
      // project: ".custom-agents/skills"
    },
    agents: {
      // "claude-code": {
      //   globalSkillsDir: "/custom/path/to/claude-skills",
      //   skillsDir: ".custom-claude/skills"
      // }
    },
  };

  saveConfig(defaultConfig);
  console.log(`${TEXT}Created config file at ${configPath}${RESET}`);
  console.log();
  console.log(`${DIM}Edit the file to customize skill paths, or use:${RESET}`);
  console.log(`  ${TEXT}skills config set <key> <value>${RESET}`);
}

function runSet(args: string[]): void {
  if (args.length < 2) {
    console.log(`${TEXT}Usage:${RESET} skills config set <key> <value>`);
    console.log();
    console.log(`${BOLD}Examples:${RESET}`);
    console.log(`  skills config set canonicalDir.global /custom/path`);
    console.log(`  skills config set agents.claude-code.globalSkillsDir /my/skills`);
    return;
  }

  const key = args[0]!;
  const value = args.slice(1).join(' ');

  setConfigValue(key, value);
  console.log(`${TEXT}Set ${key}${RESET} = ${DIM}${value}${RESET}`);
}

function runGet(args: string[]): void {
  if (args.length < 1) {
    console.log(`${TEXT}Usage:${RESET} skills config get <key>`);
    return;
  }

  const key = args[0]!;
  const value = getConfigValue(key);

  if (value === undefined) {
    console.log(`${DIM}(not set)${RESET}`);
  } else if (typeof value === 'object') {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(String(value));
  }
}

export function runConfig(args: string[]): void {
  // No args or --show: display config
  if (args.length === 0 || args.includes('--show') || args.includes('-s')) {
    showConfig();
    return;
  }

  // --help
  if (args.includes('--help') || args.includes('-h')) {
    showConfigHelp();
    return;
  }

  // --path
  if (args.includes('--path') || args.includes('-p')) {
    showPath();
    return;
  }

  // --init
  if (args.includes('--init') || args.includes('-i')) {
    initConfig();
    return;
  }

  // Subcommands
  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'set':
      runSet(subArgs);
      break;
    case 'get':
      runGet(subArgs);
      break;
    default:
      console.log(`${DIM}Unknown config subcommand: ${subcommand}${RESET}`);
      showConfigHelp();
  }
}
