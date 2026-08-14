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

// `writeSegmentation` spawns a real Worker; keep the IO module out of the test.
const ioMocks = vi.hoisted(() => ({
  readImage: vi.fn(),
  writeSegmentation: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));
vi.mock('@/src/io/readWriteImage', () => ({
  readImage: ioMocks.readImage,
  writeSegmentation: ioMocks.writeSegmentation,
}));

import JobsModule from '@/src/processing/components/JobsModule.vue';
import TaskPicker from '@/src/processing/components/TaskPicker.vue';
import TaskForm from '@/src/processing/components/TaskForm.vue';
import { useProcessingJobsStore } from '@/src/processing/store';
import { useDatasetStore } from '@/src/store/datasets';
import { useRulerStore } from '@/src/store/tools/rulers';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useMessageStore } from '@/src/store/messages';
import { useViewStore } from '@/src/store/views';

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

describe('JobsModule — race-free provider/task selection', () => {
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

  it('retries provider task discovery after a load failure', async () => {
    const p = makeProvider('P');
    p.listTasks = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce([{ id: 'x', title: 'X' }]);
    p.getTaskSpec = vi.fn().mockResolvedValue(envelope('x', 'X'));

    const store = useProcessingJobsStore();
    registerFake(store, p);
    const wrapper = mount();
    await flushPromises();

    const vm = wrapper.vm as unknown as JobsVm;
    expect(vm.providerError).toContain('provider unavailable');

    await wrapper.get('[data-testid="retry-provider"]').trigger('click');
    await flushPromises();

    expect(p.listTasks).toHaveBeenCalledTimes(2);
    expect(vm.providerError).toBeNull();
    expect(vm.tasks).toEqual([{ id: 'x', title: 'X' }]);
  });

  it('retries a failed task spec without reloading the provider', async () => {
    const p = makeProvider('P');
    p.listTasks = vi.fn().mockResolvedValue([{ id: 'x', title: 'X' }]);
    p.getTaskSpec = vi
      .fn()
      .mockRejectedValueOnce(new Error('spec unavailable'))
      .mockResolvedValueOnce(envelope('x', 'X'));

    const store = useProcessingJobsStore();
    registerFake(store, p);
    const wrapper = mount();
    await flushPromises();

    const vm = wrapper.vm as unknown as JobsVm;
    expect(vm.taskError).toContain('spec unavailable');

    await wrapper.get('[data-testid="retry-task"]').trigger('click');
    await flushPromises();

    expect(p.listTasks).toHaveBeenCalledTimes(1);
    expect(p.getTaskSpec).toHaveBeenCalledTimes(2);
    expect(vm.taskError).toBeNull();
    expect(vm.taskModel?.id).toBe('x');
  });

  it('rebinds an annotations input after the first ruler is finished', async () => {
    const p = makeProvider('P');
    p.listTasks = vi
      .fn()
      .mockResolvedValue([
        { id: 'RulerToRectangle', title: 'Ruler to Rectangle' },
      ]);
    p.getTaskSpec = vi.fn().mockResolvedValue({
      specVersion: 1,
      id: 'RulerToRectangle',
      title: 'Ruler to Rectangle',
      parameters: [
        {
          kind: 'sourceRef',
          id: 'inputVolume',
          accepts: ['image'],
          required: true,
        },
        {
          kind: 'sourceRef',
          id: 'inputAnnotations',
          title: 'Input Annotations',
          accepts: ['annotations'],
          required: true,
        },
      ],
      outputs: [],
    });

    const store = useProcessingJobsStore();
    registerFake(store, p);
    useDatasetStore().addDataSources([
      {
        dataID: 'image-1',
        dataSource: {
          type: 'uri',
          uri: 'girder://file/image-1',
          name: 'image.nrrd',
        },
      },
    ]);
    useViewStore().setDataForAllViews('image-1');

    const wrapper = mount();
    await flushPromises();
    expect(wrapper.findComponent(TaskForm).props('issues')).toEqual([
      expect.objectContaining({
        parameter: 'inputAnnotations',
        message: expect.stringMatching(/place a ruler/i),
      }),
    ]);

    useRulerStore().addRuler({
      imageID: 'image-1',
      name: 'Ruler',
      firstPoint: [0, 0, 0],
      secondPoint: [1, 1, 0],
      frameOfReference: {
        planeNormal: [0, 0, 1],
        planeOrigin: [0, 0, 0],
      },
      slice: 0,
      placing: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushPromises();

    const form = wrapper.findComponent(TaskForm);
    expect(form.props('issues')).toEqual([]);
    expect(form.props('sourceRefStates')).toMatchObject({
      inputVolume: 'bound',
      inputAnnotations: 'bound',
    });
  });
});

describe('JobsModule — segment group staging', () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    registry.clear();
    ioMocks.writeSegmentation.mockClear();
    pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
  });

  const slotStub = { template: '<div><slot /></div>' };

  const mount = () =>
    shallowMount(JobsModule, {
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

  const labelmapSpec = (multiple: boolean): TaskSpecEnvelope => ({
    specVersion: 1,
    id: 'seg',
    title: 'Segment',
    parameters: [
      {
        kind: 'sourceRef',
        id: 'inputVolume',
        accepts: ['image'],
        required: true,
      },
      {
        kind: 'sourceRef',
        id: 'inputSeg',
        accepts: ['labelmap'],
        required: true,
        ...(multiple ? { multiple: true } : {}),
      },
    ],
    outputs: [],
  });

  const seedActiveImage = () => {
    useDatasetStore().addDataSources([
      {
        dataID: 'image-1',
        dataSource: {
          type: 'uri',
          uri: 'girder://file/image-1',
          name: 'image.nrrd',
        },
      },
    ]);
    useViewStore().setDataForAllViews('image-1');
  };

  // Painted groups, in the order the store hands them back.
  const seedGroups = (names: [string, string][]) => {
    const store = useSegmentGroupStore();
    names.forEach(([id, name]) => {
      store.dataIndex[id] = {
        setSegments: () => {},
      } as unknown as (typeof store.dataIndex)[string];
      store.metadataByID[id] = {
        name,
        parentImage: 'image-1',
        segments: { order: [], byValue: {} },
      };
      (store.orderByParent['image-1'] ??= []).push(id);
    });
  };

  const stagingProvider = (spec: TaskSpecEnvelope): FakeProvider => {
    const p = makeProvider('P');
    p.listTasks = vi.fn().mockResolvedValue([{ id: 'seg', title: 'Segment' }]);
    p.getTaskSpec = vi.fn().mockResolvedValue(spec);
    p.stageInput = vi.fn(async (request) => [
      `girder://staged/${request.descriptor.name}`,
    ]);
    return p;
  };

  const submit = async (spec: TaskSpecEnvelope) => {
    const p = stagingProvider(spec);
    const store = useProcessingJobsStore();
    registerFake(store, p);

    const wrapper = mount();
    await flushPromises();

    const form = wrapper.findComponent(TaskForm);
    expect(form.props('issues')).toEqual([]);

    const submitSpy = vi.spyOn(store, 'submitJob').mockResolvedValue('job-1');
    form.vm.$emit('submit', form.props('values'));
    await flushPromises();
    return { provider: p, submitSpy };
  };

  it('stages every group of a multiple param in store order', async () => {
    seedActiveImage();
    seedGroups([
      ['group-1', 'Tumor'],
      ['group-2', 'Liver'],
    ]);

    const { provider, submitSpy } = await submit(labelmapSpec(true));

    expect(provider.stageInput).toHaveBeenCalledTimes(2);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy.mock.calls[0][2].inputSeg).toEqual({
      type: 'labelmap',
      uris: [
        'girder://staged/Tumor-1.seg.nrrd',
        'girder://staged/Liver-2.seg.nrrd',
      ],
    });
  });

  it('keeps staged file names unique for identically named groups', async () => {
    seedActiveImage();
    seedGroups([
      ['group-1', 'Tumor'],
      ['group-2', 'Tumor'],
    ]);

    const { provider, submitSpy } = await submit(labelmapSpec(true));

    const names = provider.stageInput.mock.calls.map(
      (call) => call[0].descriptor.name
    );
    expect(new Set(names).size).toBe(2);
    expect(names).toEqual(['Tumor-1.seg.nrrd', 'Tumor-2.seg.nrrd']);
    expect(submitSpy.mock.calls[0][2].inputSeg).toEqual({
      type: 'labelmap',
      uris: [
        'girder://staged/Tumor-1.seg.nrrd',
        'girder://staged/Tumor-2.seg.nrrd',
      ],
    });
  });

  it('stages only the active group of a singular param', async () => {
    seedActiveImage();
    seedGroups([
      ['group-1', 'Tumor'],
      ['group-2', 'Liver'],
    ]);
    usePaintToolStore().setActiveSegmentGroup('group-2');

    const { provider, submitSpy } = await submit(labelmapSpec(false));

    expect(provider.stageInput).toHaveBeenCalledTimes(1);
    expect(submitSpy.mock.calls[0][2].inputSeg).toEqual({
      type: 'labelmap',
      uris: ['girder://staged/Liver.seg.nrrd'],
    });
  });

  it('reports a staging failure and submits nothing', async () => {
    seedActiveImage();
    seedGroups([
      ['group-1', 'Tumor'],
      ['group-2', 'Liver'],
    ]);

    const p = stagingProvider(labelmapSpec(true));
    p.stageInput = vi.fn(async (request) => {
      if (request.descriptor.name === 'Liver-2.seg.nrrd')
        throw new Error('upload rejected');
      return ['girder://staged/Tumor-1.seg.nrrd'];
    });
    const store = useProcessingJobsStore();
    registerFake(store, p);

    const wrapper = mount();
    await flushPromises();
    const form = wrapper.findComponent(TaskForm);
    const submitSpy = vi.spyOn(store, 'submitJob');
    form.vm.$emit('submit', form.props('values'));
    await flushPromises();

    expect(submitSpy).not.toHaveBeenCalled();
    expect(useMessageStore().messages).toEqual([
      expect.objectContaining({
        title: 'Failed to stage segment group input',
      }),
    ]);
    // The form is usable again rather than stuck mid-submission.
    expect(form.props('submitting')).toBe(false);
  });
});
