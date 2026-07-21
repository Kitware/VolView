import { z } from 'zod';

import { isOriginAllowed, resolveOrigin } from '@/src/io/originGate';
import type { ProcessingProviderConfig } from '@/src/processing/types';

// Non-strict so a version-skewed backend emitting unknown keys still registers.
// `satisfies` keeps the schema and the hand-written type from drifting.
const processingProviderConfig = z.object({
  id: z.string(),
  label: z.string(),
  baseUrl: z.string(),
  // No baseUrl fallback in the transport, so a missing value mis-routes job calls.
  jobsBaseUrl: z.string(),
}) satisfies z.ZodType<ProcessingProviderConfig>;

// The `processing` top-level config section, registered with the config-section
// registry from the feature entry point (see ./index.ts).
export const processingSection = z
  .object({
    providers: z.array(processingProviderConfig).default([]),
  })
  .optional();

export type ProcessingSection = z.output<typeof processingSection>;

const isProviderOriginAllowed = (config: ProcessingProviderConfig): boolean => {
  // Both URLs carry the bearer token, so an ungated one would leak it off-origin.
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

export const selectAllowedProviders = (
  section: ProcessingSection
): ProcessingProviderConfig[] => {
  const providersConfig = section?.providers;
  if (!providersConfig?.length) return [];
  return providersConfig.filter(isProviderOriginAllowed);
};
