#!/usr/bin/env tsx

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { agents } from '../src/agents.js';

const ROOT = join(import.meta.dirname, '..');
const README_PATH = join(ROOT, 'README.md');
const PACKAGE_PATH = join(ROOT, 'package.json');

function generateAgentList(): string {
  const agentList = Object.values(agents);
  const count = agentList.length;
  return `Supports **Opencode**, **Claude Code**, **Codex**, **Cursor**, and [${count - 4} more](#available-agents).`;
}

function generateAgentNames(): string {
  return 'Target specific agents (e.g., `claude-code`, `codex`). See [Available Agents](#available-agents)';
}

function generateAvailableAgentsTable(): string {
  const rows = Object.entries(agents).map(([key, a]) => {
    const globalPath = a.globalSkillsDir.replace(homedir(), '~');
    return `| ${a.displayName} | \`${key}\` | \`${a.skillsDir}/\` | \`${globalPath}/\` |`;
  });
  return [
    '| Agent | `--agent` | Project Path | Global Path |',
    '|-------|-----------|--------------|-------------|',
    ...rows,
  ].join('\n');
}

function generateSkillDiscoveryPaths(): string {
  const standardPaths = [
    '- Root directory (if it contains `SKILL.md`)',
    '- `skills/`',
    '- `skills/.curated/`',
    '- `skills/.experimental/`',
    '- `skills/.system/`',
  ];

  const agentPaths = [...new Set(Object.values(agents).map((a) => a.skillsDir))]
    .map((p) => `- \`.${p.startsWith('.') ? p.slice(1) : '/' + p}/\``);

  return [...standardPaths, ...agentPaths].join('\n');
}

function generateKeywords(): string[] {
  const baseKeywords = ['cli', 'agent-skills', 'skills', 'ai-agents'];
  const agentKeywords = Object.keys(agents);
  return [...baseKeywords, ...agentKeywords];
}

function replaceSection(content: string, marker: string, replacement: string, inline = false): string {
  const regex = new RegExp(
    `(<!-- ${marker}:start -->)[\\s\\S]*?(<!-- ${marker}:end -->)`,
    'g'
  );
  if (inline) {
    return content.replace(regex, `$1${replacement}$2`);
  }
  return content.replace(regex, `$1\n${replacement}\n$2`);
}

function main() {
  let readme = readFileSync(README_PATH, 'utf-8');

  readme = replaceSection(readme, 'agent-list', generateAgentList());
  readme = replaceSection(readme, 'agent-names', generateAgentNames(), true);
  readme = replaceSection(readme, 'available-agents', generateAvailableAgentsTable());
  readme = replaceSection(readme, 'skill-discovery', generateSkillDiscoveryPaths());

  writeFileSync(README_PATH, readme);
  console.log('README.md updated');

  const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf-8'));
  pkg.keywords = generateKeywords();
  writeFileSync(PACKAGE_PATH, JSON.stringify(pkg, null, 2) + '\n');
  console.log('package.json updated');
}

main();
