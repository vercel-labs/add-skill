// Types
export type {
  AgentType,
  Skill,
  AgentConfig,
  ParsedSource,
  RemoteSkill,
  MintlifySkill,
} from './types.ts';
export type { InstallMode, InstallResult } from './installer.ts';
export type { WellKnownSkill, WellKnownIndex, WellKnownSkillEntry } from './providers/wellknown.ts';
export type { HostProvider, ProviderMatch, ProviderRegistry } from './providers/types.ts';

// Agents
export { detectInstalledAgents, agents, getAgentConfig } from './agents.ts';

// Install
export {
  installSkillForAgent,
  installRemoteSkillForAgent,
  installWellKnownSkillForAgent,
  isSkillInstalled,
  getInstallPath,
  getCanonicalPath,
} from './installer.ts';

// Discovery
export { discoverSkills, getSkillDisplayName, shouldInstallInternalSkills } from './skills.ts';

// Parsing
export { parseSource, getOwnerRepo } from './source-parser.ts';

// Git
export { cloneRepo, cleanupTempDir, GitCloneError } from './git.ts';

// Providers
export {
  findProvider,
  wellKnownProvider,
  registry,
  registerProvider,
  getProviders,
  mintlifyProvider,
  huggingFaceProvider,
} from './providers/index.ts';

// High-level API
export { installSkill, type InstallSkillOptions, type InstallSkillResult } from './install.ts';
