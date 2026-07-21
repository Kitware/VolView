import { z } from 'zod';

import { isOriginAllowed, resolveOrigin } from '@/src/io/originGate';
import type { Config } from '@/src/io/import/configJson';
import type { ProcessingProviderConfig } from '@/src/processing/types';

// Deliberately non-strict (zod default): unknown keys strip harmlessly so a
// non-lockstep backend (older, emitting retired keys like `protocol`/`auth`,
// or newer, emitting keys this client doesn't know) still registers. Do not
// add `.strict()` — tolerance is pinned by config.spec.ts and never loosens
// the trust boundary (the origin gate covers every egress field).
const processingProviderConfig = z.object({
  id: z.string(),
  label: z.string(),
  baseUrl: z.string(),
  // Explicit folder-free base for the job-addressed routes (status/results/cancel).
  // REQUIRED: the paired backend always advertises it, and the transport has no
  // baseUrl fallback (a job's routes are folder-free by construction). A config
  // that omits it is rejected here rather than silently mis-routing job calls
  // onto the folder-scoped baseUrl.
  jobsBaseUrl: z.string(),
});

const processingConfigShape = {
  processing: z
    .object({
      providers: z.array(processingProviderConfig).default([]),
    })
    .optional(),
};

type ConfigWithProcessing = Config & {
  processing?: {
    providers?: ProcessingProviderConfig[];
  };
};

export const withProcessingConfig = <Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>
) => schema.extend(processingConfigShape);

// Provider registration is gated by the shared runtime egress gate
// (`io/originGate`): a provider registers only if its origin is same-origin with
// the deployment. Trust attaches to where the provider points, not to how the
// config arrived — a config can never point egress at a foreign origin.
const isProviderOriginAllowed = (config: ProcessingProviderConfig): boolean => {
  // Gate EVERY egress target the provider would reach: the folder-scoped baseUrl
  // and the folder-free jobsBaseUrl the job-addressed routes use. Both carry the
  // bearer via `$fetch`, so an ungated jobsBaseUrl would be a token-exfiltration
  // hole — fail closed on either (the single egress gate).
  const targets = [config.baseUrl, config.jobsBaseUrl];

  const invalid = targets.find((url) => resolveOrigin(url) === null);
  if (invalid !== undefined) {
    console.warn(
      `Skipping processing provider "${config.id}" because baseUrl is invalid: ${invalid}`
    );
    return false;
  }

  const rejected = targets.find((url) => !isOriginAllowed(url));
  if (rejected === undefined) return true;

  console.warn(
    `Skipping processing provider "${config.id}" because origin "${resolveOrigin(
      rejected
    )}" is not allowed`
  );
  return false;
};

// Select the providers whose egress origin the runtime gate allows. PURE: it
// parses/validates (upstream schema) and returns the allowed configs, touching
// NO store — the caller (the `@/src/processing` composition root) registers
// them. Keeping this store-free is what lets `config.ts` sit in the pure layer.
export const selectAllowedProviders = (
  manifest: Config
): ProcessingProviderConfig[] => {
  const providersConfig = (manifest as ConfigWithProcessing).processing
    ?.providers;
  if (!providersConfig?.length) return [];
  // Registration is keyed by id, so ordering is immaterial.
  return providersConfig.filter(isProviderOriginAllowed);
};
