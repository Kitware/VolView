// ---------------------------------------------------------------------------
// Processing feature — PUBLIC SURFACE.
//
// Code OUTSIDE `src/processing/` imports the processing feature ONLY from here
// (enforced by the eslint import-boundary zones in `eslint.config.js`); a deep
// path into the feature is a layering violation. Everything the rest of VolView
// legitimately consumes is re-exported below, and nothing else.
// ---------------------------------------------------------------------------

import { defineAsyncComponent } from 'vue';

import type { Config } from '@/src/io/import/configJson';
import { selectAllowedProviders } from './config';
import { useProcessingJobsStore } from './store';

// The tracked-job lifecycle store (submit, poll, completion, job history).
export { useProcessingJobsStore } from './store';
// The live-only "new job result" badge store, read by the segment-group UI.
export { useJobResultReviewStore } from './jobResultReview';
// The processing config schema extension, applied during config recognition.
export { withProcessingConfig } from './config';
export type { ProcessingProviderConfig } from './types';

// The Jobs side panel, lazily loaded so its chunk (task form + widgets + job
// list) stays out of the boot bundle — ModulePanel mounts it only once a
// provider registers.
export const JobsModule = defineAsyncComponent(
  () => import('./components/JobsModule.vue')
);

// Composition root for provider registration. The pure config layer selects the
// origin-allowed providers; THIS is the single caller that touches the store,
// keeping `config.ts` store-free (the layering inversion). The bootstrap site
// (`io/import/configJson`) calls this and nothing deeper.
export const applyProcessingConfig = async (
  manifest: Config
): Promise<void> => {
  const store = useProcessingJobsStore();
  selectAllowedProviders(manifest).forEach((config) =>
    store.registerProviderConfig(config)
  );
};
