// ---------------------------------------------------------------------------
// Provider factory — lazy-loaded chunk.
//
// Composes the `ProcessingProvider` the core consumes from the one required
// engine transport. Every live HTTP path (tasks / spec / run / status / results /
// cancel / delete / stage / history) is routed by the transport over the
// bearer-aware `$fetch`; every operation is present unconditionally.
//
// The providers store dynamic-import()s this module so the engine stays out of
// the boot bundle until a provider is actually instantiated.
//
// House rules: functional style; `type`, not `interface`.
// ---------------------------------------------------------------------------

import type {
  ProcessingProvider,
  ProcessingProviderConfig,
} from '@/src/processing/types';
import { createEngineTransport } from './transport';

export const createProvider = (
  config: ProcessingProviderConfig
): ProcessingProvider => {
  const transport = createEngineTransport(config);
  // The transport already implements every ProcessingProvider method with the
  // identical names and signatures, so the provider is exactly that surface plus
  // `config` — no per-method forwarding to keep in sync with the transport.
  return { config, ...transport };
};
