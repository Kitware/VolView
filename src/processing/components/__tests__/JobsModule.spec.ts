// ---------------------------------------------------------------------------
// P-06 — race-free provider / task selection in JobsModule.
//
// The two request lifecycles (provider → tasks, task → spec model) are each
// owned by a single Vue `watch`. Every UI event only ASSIGNS the selected id;
// the watcher clears the previous selection's derived state, takes a
// request-local `active` flag (invalidated via `onCleanup`), and commits
// provider / tasks / taskModel / loading / error state ONLY while it is still
// active AND the selected id still matches. So a slower stale request can never
// clobber a newer selection — not through its success path, not its `catch`,
// not even its `finally`.
//
// These tests mount the REAL component (child SFCs auto-stubbed by shallowMount)
// against a fresh Pinia, mock the provider factory to yield a per-id
// controllable fake, and resolve/reject the deferred provider/spec promises OUT
// OF ORDER so the loser always settles after the winner has committed.
// ---------------------------------------------------------------------------

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

// Per-id fake-provider registry. The mocked engine factory returns the fake
// registered for `config.id`, so `useProcessingJobsStore().getProvider(id)` (which
// lazily dynamic-imports this module) yields a controllable provider per id.
const registry = new Map<string, ProcessingProvider>();
vi.mock('@/src/processing/engine/createProvider', () => ({
  createProvider: (config: { id: string }) => registry.get(config.id),
}));

import JobsModule from '@/src/processing/components/JobsModule.vue';
import TaskPicker from '@/src/processing/components/TaskPicker.vue';
import TaskForm from '@/src/processing/components/TaskForm.vue';
import { useProcessingJobsStore } from '@/src/processing/store';

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

type Fn = ReturnType<typeof vi.fn>;

// A fake provider: every contract method is a vi.fn the test drives. Kept as a
// distinct type (methods are `Fn`) so the test can read `.mock`/reassign them,
// while `registry` stores it under the real `ProcessingProvider` contract.
type FakeProvider = {
  config: ProcessingProviderConfig;
  listTasks: Fn;
  getTaskSpec: Fn;
  runTask: Fn;
  getJob: Fn;
  getResults: Fn;
  cancelJob: Fn;
  stageInput: Fn;
  deleteJob: Fn;
  listJobHistory: Fn;
  getJobHistoryDetail: Fn;
};

const cfg = (id: string): ProcessingProviderConfig => ({
  id,
  label: id,
  baseUrl: `http://${id}/`,
  jobsBaseUrl: `http://${id}/jobs`,
});

const makeProvider = (id: string): FakeProvider => ({
  config: cfg(id),
  listTasks: vi.fn().mockResolvedValue([]),
  getTaskSpec: vi.fn(),
  runTask: vi.fn().mockResolvedValue({ jobId: `${id}-1` }),
  getJob: vi.fn(),
  getResults: vi.fn().mockResolvedValue({
    resultState: 'ready',
    results: [],
    missing: 0,
  }),
  cancelJob: vi.fn(),
  stageInput: vi.fn().mockResolvedValue([]),
  deleteJob: vi.fn(),
  listJobHistory: vi.fn(),
  getJobHistoryDetail: vi.fn(),
});

// A minimal valid task-spec envelope (no parameters → nothing to render and
// nothing to gate, so submit is never blocked by a required input).
const envelope = (id: string, title: string): TaskSpecEnvelope => ({
  specVersion: 1,
  id,
  title,
  parameters: [],
  outputs: [],
});

// Register a fake provider both in the store (config) and the factory registry
// (instance), so the immutable-registration + lazy-getProvider flow resolves it.
const registerFake = (
  store: ReturnType<typeof useProcessingJobsStore>,
  provider: FakeProvider
) => {
  registry.set(provider.config.id, provider as unknown as ProcessingProvider);
  store.registerProviderConfig(provider.config);
};

// Internal `<script setup>` refs read off `wrapper.vm` (no defineExpose; VTU
// surfaces the setup state on `vm`).
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
    // Some core stores read injected tool singletons; install the plugin onto a
    // throwaway app the way the store unit tests do.
    createApp({}).use(pinia);
    setActivePinia(pinia);
  });

  // Slot-rendering stub: the layout wraps the form in expansion panels, and
  // VTU auto-stubs drop slot content — these keep the children reachable.
  const slotStub = { template: '<div><slot /></div>' };

  const mount = () =>
    shallowMount(JobsModule, {
      // Stub the Vuetify provider <v-select> explicitly: shallowMount otherwise
      // auto-stubs the REAL component and warns on its getter-only props. The
      // child SFCs (TaskPicker/TaskForm/JobList) are still auto-stubbed.
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

  // -------------------------------------------------------------------------
  // 1. Provider race: a stale provider's tasks resolve AFTER the winner's and
  //    must never reach component state.
  // -------------------------------------------------------------------------
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
    await flushPromises(); // A's watcher suspended at listTasks (gate pending)
    const vm = wrapper.vm as unknown as JobsVm;
    expect(vm.selectedProviderId).toBe('A');

    // Switch to B before A's tasks arrive.
    vm.selectedProviderId = 'B';
    await flushPromises(); // B's watcher suspended at listTasks (gate pending)

    // Winner (B) commits first, then the stale loser (A) resolves last.
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

  // -------------------------------------------------------------------------
  // 2. Task race + submission: pick x, then y before x's spec resolves; x's
  //    spec resolves last. The model must be y's, and submit must carry y.
  // -------------------------------------------------------------------------
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

    // Auto-select picked tasks[0] = 'x' → getTaskSpec('x') is in flight.
    expect(vm.selectedProviderId).toBe('P');
    expect(p.getTaskSpec).toHaveBeenCalledWith('x');

    // Pick 'y' through the picker before x's spec resolves.
    wrapper.findComponent(TaskPicker).vm.$emit('update:taskId', 'y');
    await flushPromises();
    expect(p.getTaskSpec).toHaveBeenCalledWith('y');

    // Winner (y) resolves first, then the stale (x) resolves last.
    specGates.y.resolve(envelope('y', 'Task Y'));
    await flushPromises();
    specGates.x.resolve(envelope('x', 'Task X'));
    await flushPromises();

    expect(vm.taskModel?.id).toBe('y');
    expect(vm.taskModel?.title).toBe('Task Y');

    // Submitting must run the winning task, never the stale one.
    const submitSpy = vi.spyOn(store, 'submitJob').mockResolvedValue('job-1');
    wrapper.findComponent(TaskForm).vm.$emit('submit', { foo: 1 });
    await flushPromises();

    expect(submitSpy).toHaveBeenCalledTimes(1);
    const [providerId, taskId] = submitSpy.mock.calls[0];
    expect(providerId).toBe('P');
    expect(taskId).toBe('y');
  });

  // -------------------------------------------------------------------------
  // 3. Exactly-one getTaskSpec per pick — the double-dispatch the fix removed.
  //    Driven THROUGH the picker (onTaskIdPicked), not a direct ref write.
  // -------------------------------------------------------------------------
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

    // The mount's auto-select is itself one legitimate spec load (tasks[0]='y').
    expect(p.getTaskSpec).toHaveBeenCalledTimes(1);
    expect(p.getTaskSpec).toHaveBeenCalledWith('y');
    p.getTaskSpec.mockClear();

    // A single user pick → exactly one spec load. Pre-P-06 the handler ALSO
    // started a request, so this same pick fired getTaskSpec twice.
    wrapper.findComponent(TaskPicker).vm.$emit('update:taskId', 'x');
    await flushPromises();

    expect(p.getTaskSpec).toHaveBeenCalledTimes(1);
    expect(p.getTaskSpec).toHaveBeenCalledWith('x');
  });

  // -------------------------------------------------------------------------
  // 4a. A stale provider generation that REJECTS after the winner took over
  //     cannot surface its error, and its `finally` cannot flip loading off
  //     while the current generation is still in flight.
  // -------------------------------------------------------------------------
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
    await flushPromises(); // B in flight (loadingProvider true, tasks pending)

    // The stale A generation fails AFTER B took over and WHILE B is still loading.
    aTasksGate.reject(new Error('A failed'));
    await flushPromises();

    expect(vm.providerError).toBeNull();
    expect(vm.loadingProvider).toBe(true); // not flipped off by the stale finally

    // B then completes normally and owns the state.
    bTasksGate.resolve([{ id: 'b1', title: 'B task' }]);
    await flushPromises();
    expect(vm.loadingProvider).toBe(false);
    expect(vm.providerError).toBeNull();
    expect(vm.tasks).toEqual([{ id: 'b1', title: 'B task' }]);
  });

  // -------------------------------------------------------------------------
  // 4b. Same guarantee for the task-spec generation.
  // -------------------------------------------------------------------------
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

    // Auto-selected 'x' → getTaskSpec('x') in flight. Pick 'y' before it resolves.
    wrapper.findComponent(TaskPicker).vm.$emit('update:taskId', 'y');
    await flushPromises();
    expect(vm.loadingTask).toBe(true);

    // The stale x generation fails AFTER y took over and WHILE y is still loading.
    specGates.x.reject(new Error('X spec failed'));
    await flushPromises();

    expect(vm.taskError).toBeNull();
    expect(vm.loadingTask).toBe(true); // not flipped off by the stale finally

    // y then completes normally and owns the model.
    specGates.y.resolve(envelope('y', 'Task Y'));
    await flushPromises();
    expect(vm.loadingTask).toBe(false);
    expect(vm.taskError).toBeNull();
    expect(vm.taskModel?.id).toBe('y');
  });
});
