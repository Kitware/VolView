// Config-by-shape + origin gate, exercised through the real import pipeline.
// There is no channel distinction: a provider config registers iff its origin
// passes the runtime gate, no matter how it arrived
// (a `config`-role uri, a plain `urls=` file, or a dropped file).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { DataSource } from '@/src/io/import/dataSource';
import type { ConfigResult } from '@/src/io/import/common';

type ProviderConfig = {
  id: string;
  label: string;
  baseUrl: string;
  jobsBaseUrl: string;
};

const configWithProvider = (
  baseUrl: string,
  extraSections: Record<string, unknown> = {}
) => ({
  processing: {
    providers: [
      {
        id: 'injected-provider',
        label: 'Injected',
        baseUrl,
        // Required; kept same-origin with baseUrl so the origin gate treats them
        // together.
        jobsBaseUrl: `${baseUrl}/jobs`,
      } satisfies ProviderConfig,
    ],
  },
  ...extraSections,
});

const jsonFile = (obj: unknown, name = 'config.json') =>
  new File([JSON.stringify(obj)], name, { type: 'application/json' });

describe('processing config injection (config-by-shape, origin-gated)', () => {
  beforeEach(() => {
    vi.resetModules();
    setActivePinia(createPinia());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a same-origin provider from a plain urls= file (no config role)', async () => {
    const [
      { importDataSources },
      { uriToDataSource },
      { useProcessingJobsStore },
    ] = await Promise.all([
      import('@/src/io/import/importDataSources'),
      import('@/src/io/import/dataSource'),
      import('@/src/processing'),
    ]);

    // No 'config' role on the parent: registration is by shape, not channel.
    const dataSource: DataSource = {
      type: 'file',
      file: jsonFile(
        configWithProvider('/api/v1/folder/abc/volview_processing')
      ),
      fileType: 'application/json',
      parent: uriToDataSource(
        'http://localhost:3000/data/some-file.json',
        'some-file.json'
      ),
    };

    await importDataSources([dataSource]);

    expect(useProcessingJobsStore().configs.size).toBe(1);
  });

  it('drops a cross-origin provider but still applies the rest of the config (demo posture)', async () => {
    const [
      { importDataSources },
      { uriToDataSource },
      { useProcessingJobsStore },
      { useWindowingStore },
    ] = await Promise.all([
      import('@/src/io/import/importDataSources'),
      import('@/src/io/import/dataSource'),
      import('@/src/processing'),
      import('@/src/store/view-configs/windowing'),
    ]);

    const dataSource: DataSource = {
      type: 'file',
      file: jsonFile(
        configWithProvider('https://analysis.example/api', {
          windowing: { level: 40, width: 400 },
        })
      ),
      fileType: 'application/json',
      parent: uriToDataSource(
        'https://demo.example/user-supplied.json',
        'user-supplied.json'
      ),
    };

    await importDataSources([dataSource]);

    expect(useProcessingJobsStore().configs.size).toBe(0);
    expect(useWindowingStore().runtimeConfigWindowLevel).toEqual({
      level: 40,
      width: 400,
    });
  });

  it('does not let a config bless its own cross-origin provider (smuggled key is inert)', async () => {
    const [
      { importDataSources },
      { uriToDataSource },
      { useProcessingJobsStore },
    ] = await Promise.all([
      import('@/src/io/import/importDataSources'),
      import('@/src/io/import/dataSource'),
      import('@/src/processing'),
    ]);

    // A config that both points a provider cross-origin AND tries to bless that
    // origin from within the config. The `allowedOrigins` key is unknown at the
    // top level, so it is STRIPPED during recognition (never applied). The known
    // `processing` section still parses, but the runtime origin gate — same-origin
    // only — rejects the cross-origin provider, so it never registers.
    const dataSource: DataSource = {
      type: 'file',
      file: jsonFile(
        configWithProvider('https://analysis.example/api', {
          allowedOrigins: ['https://analysis.example'],
        })
      ),
      fileType: 'application/json',
      parent: uriToDataSource(
        'https://attacker.example/self-extend.json',
        'self-extend.json'
      ),
    };

    await importDataSources([dataSource]).catch(() => undefined);

    expect(useProcessingJobsStore().configs.size).toBe(0);
  });

  it('keeps config-shaped processing artifacts inert', async () => {
    const [{ importVolumeDataSources }, { useProcessingJobsStore }] =
      await Promise.all([
        import('@/src/io/import/importDataSources'),
        import('@/src/processing'),
      ]);

    const dataSource: DataSource = {
      type: 'file',
      file: jsonFile(
        configWithProvider('/api/v1/folder/abc/volview_processing')
      ),
      fileType: 'application/json',
    };

    const results = await importVolumeDataSources([dataSource]);

    expect(useProcessingJobsStore().configs.size).toBe(0);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('error');
  });

  it('does not restore a state-file-shaped processing artifact', async () => {
    const { importVolumeDataSources } =
      await import('@/src/io/import/importDataSources');
    const dataSource: DataSource = {
      type: 'file',
      file: jsonFile(
        { version: '6.4.0', datasets: [], dataSources: [] },
        'session.volview.json'
      ),
      fileType: 'application/json',
    };

    const results = await importVolumeDataSources([dataSource]);

    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('error');
  });
});

describe('multiple configs merge at section granularity, last-wins (in-flight decision)', () => {
  beforeEach(() => {
    vi.resetModules();
    setActivePinia(createPinia());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies each recognized config in order; a later section overwrites an earlier one, others coexist', async () => {
    const [
      { applyPreStateConfig, config },
      { useWindowingStore },
      { useSegmentGroupStore },
    ] = await Promise.all([
      import('@/src/io/import/configJson'),
      import('@/src/store/view-configs/windowing'),
      import('@/src/store/segmentGroups'),
    ]);

    // Config A sets windowing.
    await applyPreStateConfig(
      config.parse({ windowing: { level: 40, width: 400 } })
    );
    // Config B touches a DIFFERENT section — A's windowing must survive.
    await applyPreStateConfig(
      config.parse({ io: { segmentGroupSaveFormat: 'nrrd' } })
    );
    // Config C revisits windowing — last-wins for that section.
    await applyPreStateConfig(
      config.parse({ windowing: { level: 80, width: 800 } })
    );

    expect(useWindowingStore().runtimeConfigWindowLevel).toEqual({
      level: 80,
      width: 800,
    });
    expect(useSegmentGroupStore().saveFormat).toBe('nrrd');
  });
});

describe('config with unknown top-level keys applies known sections (forward-compat)', () => {
  beforeEach(() => {
    vi.resetModules();
    setActivePinia(createPinia());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a config result naming the ignored key (warning), not a Skip', async () => {
    const [
      { default: handleConfig },
      { useMessageStore },
      { isConfigResult },
      { Skip },
    ] = await Promise.all([
      import('@/src/io/import/processors/handleConfig'),
      import('@/src/store/messages'),
      import('@/src/io/import/common'),
      import('@/src/utils/evaluateChain'),
    ]);

    const dataSource: DataSource = {
      type: 'file',
      file: jsonFile({
        windowing: { level: 40, width: 400 },
        futureSection: { enabled: true }, // newer config on an older client
      }),
      fileType: 'application/json',
    };

    const result = await handleConfig(dataSource);

    // The config is consumed (and its known section will be applied downstream),
    // NOT dropped (`Skip`) to a failed data import.
    expect(result).not.toBe(Skip);
    const configResult = result as ConfigResult;
    expect(isConfigResult(configResult)).toBe(true);
    expect(configResult.config.windowing).toEqual({ level: 40, width: 400 });

    // The ignored top-level key is surfaced (user-visible notification).
    const messages = useMessageStore().messages;
    const warning = messages.find(
      (m) => m.title === 'Unrecognized configuration'
    );
    expect(warning).toBeDefined();
    expect(warning?.options.details).toContain('futureSection');
  });
});
