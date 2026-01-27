// Export types
export type { HostProvider, ProviderMatch, ProviderRegistry, RemoteSkill } from './types.ts';

// Export registry functions
export { registry, registerProvider, findProvider, getProviders } from './registry.ts';

// Export individual providers
export { MintlifyProvider, mintlifyProvider } from './mintlify.ts';
export { HuggingFaceProvider, huggingFaceProvider } from './huggingface.ts';
export {
  WellKnownProvider,
  wellKnownProvider,
  type WellKnownIndex,
  type WellKnownSkillEntry,
  type WellKnownSkill,
} from './wellknown.ts';

// Register all built-in providers
import { registerProvider } from './registry.ts';
import { mintlifyProvider } from './mintlify.ts';
import { huggingFaceProvider } from './huggingface.ts';
import { wellKnownProvider } from './wellknown.ts';

registerProvider(mintlifyProvider);
registerProvider(huggingFaceProvider);
// Note: wellKnownProvider is NOT registered here - it's a fallback provider
// that should only be used explicitly when parsing detects a well-known URL
