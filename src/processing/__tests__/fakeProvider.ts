import { vi } from 'vitest';
import type {
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
