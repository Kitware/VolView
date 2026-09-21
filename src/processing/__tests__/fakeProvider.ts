import { vi } from 'vitest';
import type {
  ProcessingJobStatus,
  ProcessingProvider,
  ProcessingProviderConfig,
} from '@/src/processing/types';

type Fn = ReturnType<typeof vi.fn>;

// Methods keep their real signatures intersected with `Fn` so tests can read
// `.mock` and reassign them while the fake stays a valid `ProcessingProvider`.
export type FakeProvider = {
  [K in Exclude<keyof ProcessingProvider, 'config'>]: ProcessingProvider[K] &
    Fn;
} & { config: ProcessingProviderConfig };

// One factory listing every provider method, so adding a method to
// `ProcessingProvider` is reflected in each suite's fakes from one place.
export const makeFakeProvider = (
  config: ProcessingProviderConfig,
  overrides: Partial<ProcessingProvider> = {}
): FakeProvider =>
  ({
    config,
    listTasks: vi.fn().mockResolvedValue([]),
    getTaskSpec: vi.fn(),
    runTask: vi.fn(),
    getJob: vi.fn(),
    getResults: vi.fn().mockResolvedValue({ results: [], missing: 0 }),
    cancelJob: vi.fn(),
    stageInput: vi.fn().mockResolvedValue([]),
    deleteJob: vi.fn().mockResolvedValue(undefined),
    listJobHistory: vi.fn().mockResolvedValue({ jobs: [], nextCursor: null }),
    getJobHistoryDetail: vi.fn(),
    ...overrides,
  }) as FakeProvider;

export const resultStateFor = (state: ProcessingJobStatus['state']) =>
  state === 'success'
    ? ('ready' as const)
    : state === 'error' || state === 'cancelled'
      ? ('unavailable' as const)
      : ('waiting' as const);

export const jobStatus = (
  jobId: string,
  state: ProcessingJobStatus['state'],
  extra: Partial<ProcessingJobStatus> = {}
): ProcessingJobStatus => ({
  jobId,
  state,
  resultState: resultStateFor(state),
  ...extra,
});

type ProviderRegistry = {
  registerProviderConfig(config: ProcessingProviderConfig): void;
  instances: Map<string, ProcessingProvider>;
};

// Seating the instance is what a transport load would have produced.
export const registerFake = (
  store: ProviderRegistry,
  provider: FakeProvider
) => {
  store.registerProviderConfig(provider.config);
  store.instances.set(
    provider.config.id,
    provider as unknown as ProcessingProvider
  );
};
