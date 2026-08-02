import { MODELS, type ModelId, type Provider } from '@/lib/models';
import type { ImageProvider } from './types';
import { googleProvider } from './google';

// Registry of implemented provider adapters, keyed by Provider. OpenAI is deliberately
// absent until an adapter exists (see Task R2 scope note) — `providerFor` and
// `isModelAvailable` both treat a missing entry as "not implemented yet", not an error
// in the registry itself.
const PROVIDERS: Partial<Record<Provider, ImageProvider>> = {
  google: googleProvider,
};

const PROVIDER_LABELS: Record<Provider, string> = {
  google: 'Google',
  openai: 'OpenAI',
};

export function providerFor(model: ModelId): ImageProvider {
  const providerName = MODELS[model].provider;
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new Error(`${PROVIDER_LABELS[providerName]} adapter not implemented yet (model "${model}")`);
  }
  return provider;
}

export function isModelAvailable(model: ModelId): { available: boolean; reason?: string } {
  const providerName = MODELS[model].provider;
  const provider = PROVIDERS[providerName];
  if (!provider) {
    return { available: false, reason: `${PROVIDER_LABELS[providerName]} adapter not implemented yet` };
  }
  if (!process.env[provider.envVar]) {
    return { available: false, reason: `${provider.envVar} is not set` };
  }
  return { available: true };
}
