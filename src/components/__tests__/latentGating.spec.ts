// Processing and remote-save code ship in every build but stay inert until a
// runtime signal turns them on. These tests pin the two runtime gates:
//   - Jobs tab       ⇒ ModulePanel reveals it only when `configs.size > 0`.
//   - Remote save     ⇒ the surface/egress engage only when `saveUrl !== ''`.

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { shallowMount, flushPromises, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Keep the Jobs async-component cheap and DOM-safe if it ever renders.
vi.mock('@/src/processing/components/JobsModule.vue', () => ({
  default: { name: 'JobsModule', template: '<div />' },
}));

// Observe remote-save egress without a network round-trip or the heavy
// serialize path.
vi.mock('@/src/utils/fetch', () => ({
  $fetch: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/src/io/state-file/serialize', () => ({
  serialize: vi
    .fn()
    .mockResolvedValue(new Blob(['x'], { type: 'application/zip' })),
}));

import ModulePanel from '@/src/components/ModulePanel.vue';
import { useProcessingJobsStore } from '@/src/processing';
import useRemoteSaveStateStore from '@/src/store/remote-save-state';
import { ConnectionState, useServerStore } from '@/src/store/server';
import { $fetch } from '@/src/utils/fetch';
import type { ProcessingProviderConfig } from '@/src/processing';

// Stub the Vuetify shell so mounting ModulePanel exercises only its own gating
// logic (we read the `modules` computed, never the rendered DOM).
const vuetifyStubs = {
  'v-tabs': true,
  'v-tab': true,
  'v-window': true,
  'v-window-item': true,
  'v-icon': true,
};

const mountModulePanel = () =>
  shallowMount(ModulePanel, { global: { stubs: vuetifyStubs } });

const moduleNames = (wrapper: VueWrapper) =>
  (wrapper.vm as unknown as { modules: { name: string }[] }).modules.map(
    (m) => m.name
  );

const sampleProvider: ProcessingProviderConfig = {
  id: 'p1',
  label: 'Fake Provider',
  baseUrl: 'http://localhost/',
  jobsBaseUrl: 'http://localhost/jobs',
};

describe('Jobs tab is latent — gated on provider presence', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it('shows no Jobs tab when no provider is configured', async () => {
    wrapper = mountModulePanel();
    await flushPromises();

    expect(moduleNames(wrapper)).not.toContain('Jobs');
  });

  it('reveals the Jobs tab once a provider registers', async () => {
    wrapper = mountModulePanel();
    await flushPromises();
    expect(moduleNames(wrapper)).not.toContain('Jobs');

    useProcessingJobsStore().registerProviderConfig(sampleProvider);
    await flushPromises();

    expect(moduleNames(wrapper)).toContain('Jobs');
  });

  it('keeps the selected module when the Jobs tab is inserted before it', async () => {
    const server = useServerStore();
    server.setUrl('http://localhost:9999');
    server.connState = ConnectionState.Connected;
    wrapper = mountModulePanel();
    await flushPromises();

    const vm = wrapper.vm as unknown as { selectedModule: string };
    vm.selectedModule = 'Remote';

    useProcessingJobsStore().registerProviderConfig(sampleProvider);
    await flushPromises();

    expect(moduleNames(wrapper)).toEqual([
      'Data',
      'Annotations',
      'Rendering',
      'Jobs',
      'Remote',
    ]);
    expect(vm.selectedModule).toBe('Remote');
  });
});

describe('Remote save is latent — gated on a save target', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked($fetch).mockClear();
  });

  it('exposes no save target and performs no egress when unconfigured', async () => {
    const store = useRemoteSaveStateStore();

    // No `save=` URL param → empty saveUrl → the remote-save surface stays
    // hidden (ControlsStrip/WelcomePage gate on `saveUrl !== ''`).
    expect(store.saveUrl).toBe('');

    await store.saveState();

    expect($fetch).not.toHaveBeenCalled();
  });

  it('performs egress only after a save target is set', async () => {
    const store = useRemoteSaveStateStore();
    const saveUrl = `${window.location.origin}/save`;
    store.setSaveUrl(saveUrl);

    await store.saveState();

    expect($fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked($fetch).mock.calls[0][0]).toBe(saveUrl);
  });
});
