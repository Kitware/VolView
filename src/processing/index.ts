// Sole entry point for the processing feature, enforced by eslint import zones.

import { defineAsyncComponent } from 'vue';

import { registerConfigSection } from '@/src/io/import/configJson';
import { onLaunchLoadComplete } from '@/src/core/launchLoad';
import {
  processingSection,
  selectAllowedProviders,
  type ProcessingSection,
} from './config';
import { useProcessingJobsStore } from './store';

export { useProcessingJobsStore } from './store';
export type { ProcessingProviderConfig } from './types';

// Lazy so the panel chunk stays out of the boot bundle.
export const JobsModule = defineAsyncComponent(
  () => import('./components/JobsModule.vue')
);

// The feature's top-level config section. Exported so tests can exercise the
// schema/apply contract directly; `apply` is the only caller that touches the
// store, keeping `config.ts` store-free.
export const processingConfigSection = {
  key: 'processing',
  schema: processingSection,
  apply: (section: ProcessingSection) => {
    const store = useProcessingJobsStore();
    selectAllowedProviders(section).forEach((config) =>
      store.registerProviderConfig(config)
    );
  },
};

// Module-evaluation-time registration: this entry point is statically imported
// at boot (App.vue), which runs before any config file can be recognized.
registerConfigSection(processingConfigSection);

// Job re-discovery after reload: once the launch data + providers are in,
// re-find THIS study's jobs for the Jobs panel — still-running jobs join the
// normal poller (finishing while open fires the ordinary in-session live
// path), terminal ones are observability rows only. Inert with no configured
// provider (the demo posture registers none) and never fatal to the load.
onLaunchLoadComplete(async () => {
  try {
    await useProcessingJobsStore().adoptJobHistory();
  } catch (err) {
    console.error('Job re-discovery failed', err);
  }
});
