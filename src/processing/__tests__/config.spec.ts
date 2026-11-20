import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  processingSection,
  type ProcessingSection,
} from '@/src/processing/config';
import { processingConfigSection } from '@/src/processing';
import { useProcessingJobsStore } from '@/src/processing/store';

function providerSection(
  baseUrl: string,
  id = 'analysis-provider'
): ProcessingSection {
  return processingSection.parse({
    providers: [
      {
        id,
        label: 'Analysis',
        baseUrl,
        // Relative so foreign-origin fixtures fail on baseUrl, not this field.
        jobsBaseUrl: '/api/v1/volview_processing',
      },
    ],
  });
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

    await processingConfigSection.apply(providerSection('/volview_processing'));

    expect(providers.configs.size).toBe(1);
    expect(providers.configs.get('analysis-provider')?.baseUrl).toBe(
      '/volview_processing'
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects foreign-origin providers', async () => {
    const providers = useProcessingJobsStore();

    await processingConfigSection.apply(
      providerSection('https://analysis.example/api')
    );

    expect(providers.configs.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'origin "https://analysis.example" is not allowed'
      )
    );
  });

  it('never lets a config point egress at a foreign origin (self-extension invariant)', async () => {
    const providers = useProcessingJobsStore();

    await processingConfigSection.apply(
      providerSection('https://analysis.example/api')
    );

    expect(providers.configs.size).toBe(0);
  });

  it('registers a provider from a config block without protocol/auth', async () => {
    const providers = useProcessingJobsStore();

    await processingConfigSection.apply(providerSection('/volview_processing'));

    const registered = providers.configs.get('analysis-provider');
    expect(providers.configs.size).toBe(1);
    expect(registered?.baseUrl).toBe('/volview_processing');
    expect(registered && 'protocol' in registered).toBe(false);
    expect(registered && 'auth' in registered).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('preserves an explicit jobsBaseUrl through the config schema (not stripped)', async () => {
    const providers = useProcessingJobsStore();

    const section = processingSection.parse({
      providers: [
        {
          id: 'analysis-provider',
          label: 'Analysis',
          baseUrl: '/api/v1/folder/abc/volview_processing',
          jobsBaseUrl: '/api/v1/volview_processing',
        },
      ],
    });

    await processingConfigSection.apply(section);

    const registered = providers.configs.get('analysis-provider');
    expect(providers.configs.size).toBe(1);
    expect(registered?.jobsBaseUrl).toBe('/api/v1/volview_processing');
    expect(warn).not.toHaveBeenCalled();
  });

  // An ungated jobsBaseUrl would exfiltrate the bearer token sent on job routes.
  it('rejects a provider whose jobsBaseUrl is cross-origin (gate covers both bases)', async () => {
    const providers = useProcessingJobsStore();

    const section = processingSection.parse({
      providers: [
        {
          id: 'analysis-provider',
          label: 'Analysis',
          baseUrl: '/api/v1/folder/abc/volview_processing',
          jobsBaseUrl: 'https://analysis.example/jobs',
        },
      ],
    });

    await processingConfigSection.apply(section);

    expect(providers.configs.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'origin "https://analysis.example" is not allowed'
      )
    );
  });

  it('strips unknown provider keys (e.g. retired protocol/auth) instead of rejecting the provider', async () => {
    const providers = useProcessingJobsStore();

    const section = processingSection.parse({
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
    });

    await processingConfigSection.apply(section);

    const registered = providers.configs.get('analysis-provider');
    expect(providers.configs.size).toBe(1);
    expect(registered?.baseUrl).toBe('/volview_processing');
    expect(registered && 'protocol' in registered).toBe(false);
    expect(registered && 'auth' in registered).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects a provider config that omits the required jobsBaseUrl (fails to parse, not registered)', async () => {
    const providers = useProcessingJobsStore();

    const parsed = processingSection.safeParse({
      providers: [
        {
          id: 'analysis-provider',
          label: 'Analysis',
          baseUrl: '/volview_processing',
        },
      ],
    });

    expect(parsed.success).toBe(false);
    expect(providers.configs.size).toBe(0);
  });
});
