// Dynamically imported so the engine stays out of the boot bundle.

import type {
  ProcessingProvider,
  ProcessingProviderConfig,
} from '@/src/processing/types';
import { createEngineTransport } from './transport';

export const createProvider = (
  config: ProcessingProviderConfig
): ProcessingProvider => {
  const transport = createEngineTransport(config);
  return { config, ...transport };
};
