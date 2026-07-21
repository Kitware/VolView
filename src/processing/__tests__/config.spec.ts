import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { config as baseConfig } from '@/src/io/import/configJson';
import { withProcessingConfig } from '@/src/processing/config';
import { applyProcessingConfig } from '@/src/processing';
import { useProcessingJobsStore } from '@/src/processing/store';
import type { Config } from '@/src/io/import/configJson';

function processingConfig(baseUrl: string, id = 'analysis-provider'): Config {
  return withProcessingConfig(baseConfig).parse({
    processing: {
      providers: [
        {
          id,
          label: 'Analysis',
          baseUrl,
          // jobsBaseUrl is now REQUIRED by the schema. Same-origin (relative)
          // so the egress gate passes for the same-origin fixtures and fails
          // on baseUrl (not this field) for the foreign-origin ones.
          jobsBaseUrl: '/api/v1/volview_processing',
        },
      ],
    },
  }) as Config;
}

describe('processing config provider origins', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts same-origin providers with zero config', async () => {
    const providers = useProcessingJobsStore();

    await applyProcessingConfig(processingConfig('/volview_processing'));

    expect(providers.providerCount).toBe(1);
    expect(providers.configs.get('analysis-provider')?.baseUrl).toBe(
      '/volview_processing'
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects foreign-origin providers', async () => {
    const providers = useProcessingJobsStore();

    await applyProcessingConfig(
      processingConfig('https://analysis.example/api')
    );

    expect(providers.providerCount).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'origin "https://analysis.example" is not allowed'
      )
    );
  });

  // Trust attaches to where the provider points, not to how the config arrived:
  // a config can never bless a foreign origin for itself. Egress is same-origin
  // only, full stop.
  it('never lets a config point egress at a foreign origin (self-extension invariant)', async () => {
    const providers = useProcessingJobsStore();

    await applyProcessingConfig(
      processingConfig('https://analysis.example/api')
    );

    expect(providers.providerCount).toBe(0);
  });

  // The backend dropped the vestigial
  // `protocol`/`auth` provider-config fields. The client schema
  // (`processingProviderConfig`) reads only id/label/baseUrl/jobsBaseUrl, so a
  // provider registers from a config block that OMITS those fields.
  it('registers a provider from a config block without protocol/auth', async () => {
    const providers = useProcessingJobsStore();

    await applyProcessingConfig(processingConfig('/volview_processing'));

    const registered = providers.configs.get('analysis-provider');
    expect(providers.providerCount).toBe(1);
    expect(registered?.baseUrl).toBe('/volview_processing');
    // The dropped fields were never part of the client shape.
    expect(registered && 'protocol' in registered).toBe(false);
    expect(registered && 'auth' in registered).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  // The explicit folder-free `jobsBaseUrl` (job-addressed routes)
  // must SURVIVE the config zod schema — zod strips unknown keys, so a field the
  // schema omits would be silently dropped before it reaches the provider.
  it('preserves an explicit jobsBaseUrl through the config schema (not stripped)', async () => {
    const providers = useProcessingJobsStore();

    const manifest = withProcessingConfig(baseConfig).parse({
      processing: {
        providers: [
          {
            id: 'analysis-provider',
            label: 'Analysis',
            baseUrl: '/api/v1/folder/abc/volview_processing',
            jobsBaseUrl: '/api/v1/volview_processing',
          },
        ],
      },
    }) as Config;

    await applyProcessingConfig(manifest);

    const registered = providers.configs.get('analysis-provider');
    expect(providers.providerCount).toBe(1);
    expect(registered?.jobsBaseUrl).toBe('/api/v1/volview_processing');
    expect(warn).not.toHaveBeenCalled();
  });

  // ...and the egress gate covers jobsBaseUrl too (fail closed): a provider
  // whose baseUrl is same-origin but whose jobsBaseUrl points cross-origin is
  // REFUSED — the job-addressed routes carry the bearer via $fetch, so an ungated
  // jobsBaseUrl would be a token-exfiltration hole.
  it('rejects a provider whose jobsBaseUrl is cross-origin (gate covers both bases)', async () => {
    const providers = useProcessingJobsStore();

    const manifest = withProcessingConfig(baseConfig).parse({
      processing: {
        providers: [
          {
            id: 'analysis-provider',
            label: 'Analysis',
            baseUrl: '/api/v1/folder/abc/volview_processing',
            jobsBaseUrl: 'https://analysis.example/jobs',
          },
        ],
      },
    }) as Config;

    await applyProcessingConfig(manifest);

    expect(providers.providerCount).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'origin "https://analysis.example" is not allowed'
      )
    );
  });

  // The provider config object is DELIBERATELY tolerant-reader (zod's default
  // non-strict parse) — same design as the top-level config sections: unknown
  // keys strip harmlessly instead of sinking the provider, so a non-lockstep
  // backend (older, emitting the retired `protocol`/`auth` keys, or newer,
  // emitting keys this client doesn't know yet) still registers. NOT a legacy
  // shim — there is no code path to retire; do not "fix" this with `.strict()`.
  // Tolerance never loosens the trust boundary: unknown keys are stripped, and
  // the origin gate covers every egress field.
  it('strips unknown provider keys (e.g. retired protocol/auth) instead of rejecting the provider', async () => {
    const providers = useProcessingJobsStore();

    const manifest = withProcessingConfig(baseConfig).parse({
      processing: {
        providers: [
          {
            id: 'analysis-provider',
            label: 'Analysis',
            baseUrl: '/volview_processing',
            jobsBaseUrl: '/api/v1/volview_processing',
            protocol: 'slicer-cli',
            auth: 'same-origin',
          },
        ],
      },
    }) as Config;

    await applyProcessingConfig(manifest);

    const registered = providers.configs.get('analysis-provider');
    expect(providers.providerCount).toBe(1);
    expect(registered?.baseUrl).toBe('/volview_processing');
    expect(registered && 'protocol' in registered).toBe(false);
    expect(registered && 'auth' in registered).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  // jobsBaseUrl is REQUIRED: the job-addressed routes (status/results/cancel)
  // are folder-free and the transport has no baseUrl fallback, so a provider
  // that omits jobsBaseUrl is a configuration error. The schema is the gate —
  // it fails to parse, so the provider never reaches registration.
  it('rejects a provider config that omits the required jobsBaseUrl (fails to parse, not registered)', async () => {
    const providers = useProcessingJobsStore();

    const parsed = withProcessingConfig(baseConfig).safeParse({
      processing: {
        providers: [
          {
            id: 'analysis-provider',
            label: 'Analysis',
            baseUrl: '/volview_processing',
            // jobsBaseUrl intentionally omitted — now a required field.
          },
        ],
      },
    });

    // The schema rejects the manifest outright...
    expect(parsed.success).toBe(false);
    // ...so nothing was ever registered.
    expect(providers.providerCount).toBe(0);
  });
});
