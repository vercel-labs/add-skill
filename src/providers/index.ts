// Export types
export type { HostProvider, ProviderMatch, ProviderRegistry, RemoteSkill } from './types.js';

// Export registry functions
export { registry, registerProvider, findProvider, getProviders } from './registry.js';

// Export individual providers
export { MintlifyProvider, mintlifyProvider } from './mintlify.js';
export { HuggingFaceProvider, huggingFaceProvider } from './huggingface.js';
export {
  WellKnownProvider,
  wellKnownProvider,
  type WellKnownIndex,
  type WellKnownSkillEntry,
  type WellKnownSkill,
} from './wellknown.js';

// Register all built-in providers
import { registerProvider } from './registry.js';
import { mintlifyProvider } from './mintlify.js';
import { huggingFaceProvider } from './huggingface.js';
import { wellKnownProvider } from './wellknown.js';

registerProvider(mintlifyProvider);
registerProvider(huggingFaceProvider);
// Note: wellKnownProvider is NOT registered here - it's a fallback provider
// that should only be used explicitly when parsing detects a well-known URL
