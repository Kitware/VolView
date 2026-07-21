import { describe, it, beforeEach, expect, vi } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createApp } from 'vue';

import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { defer, type Deferred } from '@/src/utils';
import type {
  ProcessingProvider,
  ProcessingProviderConfig,
  TaskSummary,
} from '@/src/processing/types';
import type { TaskSpecEnvelope } from '@/src/processing/engine/taskSpec';
import {
  makeFakeProvider,
  type FakeProvider,
} from '@/src/processing/__tests__/fakeProvider';

const registry = new Map<string, ProcessingProvider>();
vi.mock('@/src/processing/engine/transport', () => ({
  createEngineTransport: (config: { id: string }) => registry.get(config.id),
}));

import JobsModule from '@/src/processing/components/JobsModule.vue';
import TaskPicker from '@/src/processing/components/TaskPicker.vue';
import TaskForm from '@/src/processing/components/TaskForm.vue';
import { useProcessingJobsStore } from '@/src/processing/store';

const cfg = (id: string): ProcessingProviderConfig => ({
  id,
  label: id,
  baseUrl: `http://${id}/`,
  jobsBaseUrl: `http://${id}/jobs`,
});

const makeProvider = (id: string): FakeProvider =>
  makeFakeProvider(cfg(id), {
    runTask: vi.fn().mockResolvedValue({ jobId: `${id}-1` }),
    getResults: vi.fn().mockResolvedValue({
      resultState: 'ready',
      results: [],
      missing: 0,
    }),
    listJobHistory: vi.fn(),
  });

// No parameters, so submit is never gated on a required input.
const envelope = (id: string, title: string): TaskSpecEnvelope => ({
  specVersion: 1,
  id,
  title,
  parameters: [],
  outputs: [],
});

const registerFake = (
  store: ReturnType<typeof useProcessingJobsStore>,
  provider: FakeProvider
) => {
  registry.set(provider.config.id, provider as unknown as ProcessingProvider);
  store.registerProviderConfig(provider.config);
};

type JobsVm = {
  selectedProviderId: string | null;
  tasks: TaskSummary[];
  taskModel: { id: string; title: string } | null;
  providerError: string | null;
  taskError: string | null;
  loadingProvider: boolean;
  loadingTask: boolean;
};

describe('JobsModule — P-06 race-free provider/task selection', () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    registry.clear();
    pinia = createPinia().use(CorePiniaProviderPlugin());
    // Core stores read injected tool singletons, which need an app to install onto.
    createApp({}).use(pinia);
    setActivePinia(pinia);
  });

  // Auto-stubs drop slot content, hiding the panel children.
  const slotStub = { template: '<div><slot /></div>' };

  const mount = () =>
    shallowMount(JobsModule, {
      // v-select's auto-stub warns on getter-only props.
      global: {
        plugins: [pinia],
        stubs: {
          'v-select': true,
          'v-expansion-panels': slotStub,
          'v-expansion-panel': slotStub,
          'v-expansion-panel-title': slotStub,
          'v-expansion-panel-text': slotStub,
        },
      },
    });

  it('commits only the winning provider’s tasks when the stale one resolves last', async () => {
    const a = makeProvider('A');
    const b = makeProvider('B');
    const aTasks: TaskSummary[] = [{ id: 'a1', title: 'A task' }];
    const bTasks: TaskSummary[] = [{ id: 'b1', title: 'B task' }];
    const aTasksGate = defer<TaskSummary[]>();
    const bTasksGate = defer<TaskSummary[]>();
    a.listTasks = vi.fn().mockReturnValue(aTasksGate.promise);
    b.listTasks = vi.fn().mockReturnValue(bTasksGate.promise);
    b.getTaskSpec = vi.fn(() => Promise.resolve(envelope('b1', 'B task')));

    const store = useProcessingJobsStore();
    registerFake(store, a);
    registerFake(store, b);

    const wrapper = mount();
    await flushPromises();
    const vm = wrapper.vm as unknown as JobsVm;
    expect(vm.selectedProviderId).toBe('A');

    vm.selectedProviderId = 'B';
    await flushPromises();

    bTasksGate.resolve(bTasks);
    await flushPromises();
    aTasksGate.resolve(aTasks);
    await flushPromises();

    expect(vm.tasks).toEqual(bTasks);
    expect(vm.tasks).not.toEqual(aTasks);

    const picker = wrapper.findComponent(TaskPicker);
    expect(picker.exists()).toBe(true);
    expect(picker.props('tasks')).toEqual(bTasks);
  });

  it('commits only the winning task spec and submits it when the stale spec resolves last', async () => {
    const p = makeProvider('P');
    const tasks: TaskSummary[] = [
      { id: 'x', title: 'X' },
      { id: 'y', title: 'Y' },
    ];
    p.listTasks = vi.fn().mockResolvedValue(tasks);
    const specGates: Record<string, Deferred<TaskSpecEnvelope>> = {
      x: defer<TaskSpecEnvelope>(),
      y: defer<TaskSpecEnvelope>(),
    };
    p.getTaskSpec = vi.fn((id: string) => specGates[id].promise);

    const store = useProcessingJobsStore();
    registerFake(store, p);

    const wrapper = mount();
    await flushPromises();
    const vm = wrapper.vm as unknown as JobsVm;

    expect(vm.selectedProviderId).toBe('P');
    expect(p.getTaskSpec).toHaveBeenCalledWith('x');

    wrapper.findComponent(TaskPicker).vm.$emit('update:modelValue', 'y');
    await flushPromises();
    expect(p.getTaskSpec).toHaveBeenCalledWith('y');

    specGates.y.resolve(envelope('y', 'Task Y'));
    await flushPromises();
    specGates.x.resolve(envelope('x', 'Task X'));
    await flushPromises();

    expect(vm.taskModel?.id).toBe('y');
    expect(vm.taskModel?.title).toBe('Task Y');

    const submitSpy = vi.spyOn(store, 'submitJob').mockResolvedValue('job-1');
    wrapper.findComponent(TaskForm).vm.$emit('submit', { foo: 1 });
    await flushPromises();

    expect(submitSpy).toHaveBeenCalledTimes(1);
    const [providerId, taskId] = submitSpy.mock.calls[0];
    expect(providerId).toBe('P');
    expect(taskId).toBe('y');
  });

  it('dispatches getTaskSpec exactly once per task pick (no double-dispatch)', async () => {
    const p = makeProvider('P');
    const tasks: TaskSummary[] = [
      { id: 'y', title: 'Y' },
      { id: 'x', title: 'X' },
    ];
    p.listTasks = vi.fn().mockResolvedValue(tasks);
    p.getTaskSpec = vi.fn((id: string) =>
      Promise.resolve(envelope(id, id.toUpperCase()))
    );

    const store = useProcessingJobsStore();
    registerFake(store, p);

    const wrapper = mount();
    await flushPromises();

    expect(p.getTaskSpec).toHaveBeenCalledTimes(1);
    expect(p.getTaskSpec).toHaveBeenCalledWith('y');
    p.getTaskSpec.mockClear();

    wrapper.findComponent(TaskPicker).vm.$emit('update:modelValue', 'x');
    await flushPromises();

    expect(p.getTaskSpec).toHaveBeenCalledTimes(1);
    expect(p.getTaskSpec).toHaveBeenCalledWith('x');
  });

  it('a stale provider generation that rejects cannot change current provider state', async () => {
    const a = makeProvider('A');
    const b = makeProvider('B');
    const aTasksGate = defer<TaskSummary[]>();
    const bTasksGate = defer<TaskSummary[]>();
    a.listTasks = vi.fn().mockReturnValue(aTasksGate.promise);
    b.listTasks = vi.fn().mockReturnValue(bTasksGate.promise);
    b.getTaskSpec = vi.fn(() => Promise.resolve(envelope('b1', 'B task')));

    const store = useProcessingJobsStore();
    registerFake(store, a);
    registerFake(store, b);

    const wrapper = mount();
    await flushPromises();
    const vm = wrapper.vm as unknown as JobsVm;

    vm.selectedProviderId = 'B';
    await flushPromises();

    aTasksGate.reject(new Error('A failed'));
    await flushPromises();

    expect(vm.providerError).toBeNull();
    expect(vm.loadingProvider).toBe(true);

    bTasksGate.resolve([{ id: 'b1', title: 'B task' }]);
    await flushPromises();
    expect(vm.loadingProvider).toBe(false);
    expect(vm.providerError).toBeNull();
    expect(vm.tasks).toEqual([{ id: 'b1', title: 'B task' }]);
  });

  it('a stale task generation that rejects cannot change current task state', async () => {
    const p = makeProvider('P');
    const tasks: TaskSummary[] = [
      { id: 'x', title: 'X' },
      { id: 'y', title: 'Y' },
    ];
    p.listTasks = vi.fn().mockResolvedValue(tasks);
    const specGates: Record<string, Deferred<TaskSpecEnvelope>> = {
      x: defer<TaskSpecEnvelope>(),
      y: defer<TaskSpecEnvelope>(),
    };
    p.getTaskSpec = vi.fn((id: string) => specGates[id].promise);

    const store = useProcessingJobsStore();
    registerFake(store, p);

    const wrapper = mount();
    await flushPromises();
    const vm = wrapper.vm as unknown as JobsVm;

    wrapper.findComponent(TaskPicker).vm.$emit('update:modelValue', 'y');
    await flushPromises();
    expect(vm.loadingTask).toBe(true);

    specGates.x.reject(new Error('X spec failed'));
    await flushPromises();

    expect(vm.taskError).toBeNull();
    expect(vm.loadingTask).toBe(true);

    specGates.y.resolve(envelope('y', 'Task Y'));
    await flushPromises();
    expect(vm.loadingTask).toBe(false);
    expect(vm.taskError).toBeNull();
    expect(vm.taskModel?.id).toBe('y');
  });
});
