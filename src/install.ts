import type { AgentType, RemoteSkill } from './types.ts';
import type { InstallMode, InstallResult } from './installer.ts';
import { parseSource } from './source-parser.ts';
import { cloneRepo, cleanupTempDir } from './git.ts';
import { discoverSkills, getSkillDisplayName } from './skills.ts';
import { detectInstalledAgents, agents } from './agents.ts';
import {
  installSkillForAgent,
  installRemoteSkillForAgent,
  installWellKnownSkillForAgent,
} from './installer.ts';
import { findProvider, wellKnownProvider } from './providers/index.ts';

export interface InstallSkillOptions {
  url: string;
  skills?: string[];
  agents?: AgentType[];
  global?: boolean;
  cwd?: string;
  mode?: InstallMode;
}

export interface InstallSkillResult {
  success: boolean;
  installed: Array<{ skill: string; agent: AgentType; path: string }>;
  errors: Array<{ skill: string; agent: AgentType; error: string }>;
}

/** Programmatic skill installation. Handles all source types internally. */
export async function installSkill(options: InstallSkillOptions): Promise<InstallSkillResult> {
  const {
    url,
    skills: filter,
    global: isGlobal = false,
    cwd = process.cwd(),
    mode = 'symlink',
  } = options;
  const result: InstallSkillResult = { success: true, installed: [], errors: [] };

  if (!url || typeof url !== 'string' || !url.trim()) {
    result.success = false;
    result.errors.push({ skill: '', agent: 'claude-code', error: 'URL is required' });
    return result;
  }

  let targetAgents = options.agents?.length ? options.agents : await detectInstalledAgents();
  if (!targetAgents.length) targetAgents = Object.keys(agents) as AgentType[];

  const parsed = parseSource(url);
  let tempDir: string | null = null;
  let skillsFound = false;

  const installToAgents = async (
    skills: Array<{ name: string; install: (agent: AgentType) => Promise<InstallResult> }>
  ) => {
    if (skills.length > 0) skillsFound = true;
    for (const { name, install } of skills) {
      for (const agent of targetAgents) {
        const r = await install(agent);
        if (r.success) result.installed.push({ skill: name, agent, path: r.path });
        else result.errors.push({ skill: name, agent, error: r.error || 'Unknown error' });
      }
    }
  };

  const matchesFilter = (name: string, installName?: string) =>
    !filter?.length ||
    filter.some(
      (f) =>
        f.toLowerCase() === name.toLowerCase() || f.toLowerCase() === installName?.toLowerCase()
    );

  try {
    if (parsed.type === 'well-known') {
      const all = await wellKnownProvider.fetchAllSkills(parsed.url);
      const skills = all
        .filter((s) => matchesFilter(s.name, s.installName))
        .map((s) => ({
          name: s.installName,
          install: (agent: AgentType) =>
            installWellKnownSkillForAgent(s, agent, { global: isGlobal, cwd, mode }),
        }));
      await installToAgents(skills);
    } else if (parsed.type === 'direct-url') {
      const provider = findProvider(parsed.url);
      const remote = provider ? await provider.fetchSkill(parsed.url) : null;
      if (!remote) {
        result.errors.push({
          skill: url,
          agent: targetAgents[0] ?? 'claude-code',
          error: 'Could not fetch skill',
        });
      } else {
        await installToAgents([
          {
            name: remote.installName,
            install: (agent) =>
              installRemoteSkillForAgent(remote as RemoteSkill, agent, {
                global: isGlobal,
                cwd,
                mode,
              }),
          },
        ]);
      }
    } else {
      tempDir = parsed.type === 'local' ? null : await cloneRepo(parsed.url, parsed.ref);
      const dir = parsed.type === 'local' ? parsed.localPath! : tempDir!;
      const all = await discoverSkills(dir, parsed.subpath);
      const skills = all
        .filter((s) => matchesFilter(s.name, getSkillDisplayName(s)))
        .map((s) => ({
          name: s.name,
          install: (agent: AgentType) =>
            installSkillForAgent(s, agent, { global: isGlobal, cwd, mode }),
        }));
      await installToAgents(skills);
    }

    // No skills found at the source
    if (!skillsFound && result.errors.length === 0) {
      result.errors.push({
        skill: url,
        agent: targetAgents[0] ?? 'claude-code',
        error: 'No skills found',
      });
    }
  } catch (error) {
    result.errors.push({
      skill: url,
      agent: targetAgents[0] ?? 'claude-code',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    if (tempDir) await cleanupTempDir(tempDir).catch(() => {});
  }

  result.success = result.errors.length === 0;
  return result;
}
