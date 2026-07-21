// Sole entry point for the processing feature, enforced by eslint import zones.

import { defineAsyncComponent } from 'vue';

import type { Config } from '@/src/io/import/configJson';
import { selectAllowedProviders } from './config';
import { useProcessingJobsStore } from './store';

export { useProcessingJobsStore } from './store';
export { withProcessingConfig } from './config';
export type { ProcessingProviderConfig } from './types';

// Lazy so the panel chunk stays out of the boot bundle.
export const JobsModule = defineAsyncComponent(
  () => import('./components/JobsModule.vue')
);

// Only caller that touches the store, keeping `config.ts` store-free.
export const applyProcessingConfig = async (
  manifest: Config
): Promise<void> => {
  const store = useProcessingJobsStore();
  selectAllowedProviders(manifest).forEach((config) =>
    store.registerProviderConfig(config)
  );
};
