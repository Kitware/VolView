import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { shallowMount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createApp } from 'vue';

import type { JobHistoryDetail } from '@/backend-contract';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { defer } from '@/src/utils';
import type {
  ProcessingJobStatus,
  ProcessingProvider,
} from '@/src/processing/types';
import {
  jobStatus,
  makeFakeProvider,
  registerFake,
  type FakeProvider,
} from '@/src/processing/__tests__/fakeProvider';
import JobList from '@/src/processing/components/JobList.vue';
import {
  POLL_INTERVAL_MS,
  useProcessingJobsStore,
} from '@/src/processing/store';

const JOB_ID = 'job-1';
const PARTIAL_LOG = [
  'Traceback (most recent call last):\n',
  '  File "/opt/cli/volview_cli_base/cli.py", line 25, in run\n',
];
const FINAL_LINE = 'ValueError: Lower threshold must be <= upper threshold';
const FULL_LOG = [...PARTIAL_LOG, `${FINAL_LINE}\n`];

const detail = (log: string[]): JobHistoryDetail => ({
  jobId: JOB_ID,
  log,
  parameters: {},
});

const failed = jobStatus(JOB_ID, 'error', {
  errorTail: 'DockerException: exit code 1',
});

const makeProvider = (
  overrides: Partial<ProcessingProvider> = {}
): FakeProvider =>
  makeFakeProvider(
    {
      id: 'p1',
      label: 'P1',
      baseUrl: 'http://p1/',
      jobsBaseUrl: 'http://p1/jobs',
    },
    {
      runTask: vi.fn().mockResolvedValue({ jobId: JOB_ID }),
      getJob: vi
        .fn()
        .mockResolvedValueOnce(jobStatus(JOB_ID, 'running'))
        .mockResolvedValue(failed),
      ...overrides,
    }
  );

// Clicks reach toggleDetails through the attribute fallthrough on <button>.
const btnStub = { template: '<button><slot /></button>' };
const slotStub = { template: '<div><slot /></div>' };

describe('JobList error log', () => {
  let pinia: ReturnType<typeof createPinia>;
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
  });

  // A bound base image keeps the completion path from fetching details to
  // rebuild an adopted job's parent, so every detail request comes from the row.
  const submit = async (provider: FakeProvider) => {
    const store = useProcessingJobsStore();
    registerFake(store, provider);
    await store.submitJob(
      provider.config.id,
      'threshold',
      {},
      {
        activeDatasetId: 'base',
      }
    );
    await vi.advanceTimersByTimeAsync(0);
  };

  const mountList = () => {
    wrapper = shallowMount(JobList, {
      global: {
        plugins: [pinia],
        stubs: {
          'v-btn': btnStub,
          'expand-transition': slotStub,
          VSelect: { template: '<div />' },
        },
      },
    });
    return wrapper;
  };

  const expandDetails = async (list: VueWrapper) => {
    await list.find('.details-btn').trigger('click');
    await vi.advanceTimersByTimeAsync(0);
  };

  it('shows the final log when a job fails after its details were opened', async () => {
    const provider = makeProvider({
      getJobHistoryDetail: vi
        .fn()
        .mockResolvedValueOnce(detail(PARTIAL_LOG))
        .mockResolvedValue(detail(FULL_LOG)),
    });
    await submit(provider);
    const list = mountList();

    await expandDetails(list);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(list.find('.error-log').text()).toContain(FINAL_LINE);
    expect(provider.getJobHistoryDetail).toHaveBeenCalledTimes(2);
  });

  it('keeps the final log when the earlier detail response arrives last', async () => {
    const partial = defer<JobHistoryDetail>();
    const provider = makeProvider({
      getJobHistoryDetail: vi
        .fn()
        .mockReturnValueOnce(partial.promise)
        .mockResolvedValue(detail(FULL_LOG)),
    });
    await submit(provider);
    const list = mountList();

    await expandDetails(list);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(list.find('.error-log').text()).toContain(FINAL_LINE);

    partial.resolve(detail(PARTIAL_LOG));
    await vi.advanceTimersByTimeAsync(0);

    expect(list.find('.error-log').text()).toContain(FINAL_LINE);
  });

  // Adoption completes a job it read once, without registering a poller.
  it('keeps the final log when an adopted job fails while its earlier detail is in flight', async () => {
    const partial = defer<JobHistoryDetail>();
    const adoptedStatus = defer<ProcessingJobStatus>();
    const provider = makeProvider({
      listJobHistory: vi.fn().mockResolvedValue({
        jobs: [
          {
            jobId: JOB_ID,
            taskId: 'threshold',
            taskTitle: 'Threshold',
            createdBy: { id: 'u1', name: 'User One' },
            createdAt: '2026-09-21T12:00:00Z',
            state: 'running',
            resultState: 'waiting',
          },
        ],
        nextCursor: null,
      }),
      getJob: vi.fn().mockReturnValue(adoptedStatus.promise),
      getJobHistoryDetail: vi
        .fn()
        .mockReturnValueOnce(partial.promise)
        .mockResolvedValue(detail(FULL_LOG)),
    });
    const store = useProcessingJobsStore();
    registerFake(store, provider);
    const adoption = store.adoptJobHistory();
    await vi.advanceTimersByTimeAsync(0);
    const list = mountList();

    await expandDetails(list);
    adoptedStatus.resolve(failed);
    await adoption;
    await vi.advanceTimersByTimeAsync(0);
    expect(list.find('.error-log').text()).toContain(FINAL_LINE);

    partial.resolve(detail(PARTIAL_LOG));
    await vi.advanceTimersByTimeAsync(0);

    expect(list.find('.error-log').text()).toContain(FINAL_LINE);
  });

  it('fetches the details of an already failed job once', async () => {
    const provider = makeProvider({
      runTask: vi.fn().mockResolvedValue({ jobId: JOB_ID, status: failed }),
      getJobHistoryDetail: vi.fn().mockResolvedValue(detail(FULL_LOG)),
    });
    await submit(provider);
    const list = mountList();

    await expandDetails(list);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);

    expect(list.find('.error-log').text()).toContain(FINAL_LINE);
    expect(provider.getJobHistoryDetail).toHaveBeenCalledTimes(1);
  });

  it('fetches no details when a job whose details were never opened finishes', async () => {
    const provider = makeProvider({
      getJobHistoryDetail: vi.fn().mockResolvedValue(detail(FULL_LOG)),
    });
    await submit(provider);
    const list = mountList();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);

    expect(list.find('.job-row').exists()).toBe(true);
    expect(provider.getJobHistoryDetail).not.toHaveBeenCalled();
  });
});
