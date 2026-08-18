import { describe, it, beforeEach, expect } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useReferenceLinesStore } from '../store';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';

describe('Reference lines store', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('defaults to disabled and invisible', () => {
    const store = useReferenceLinesStore();

    expect(store.enabled).toBe(false);
    expect(store.visible).toBe(false);
  });

  it('is visible when the setting is on and no tool is active', () => {
    const store = useReferenceLinesStore();

    store.enabled = true;

    expect(store.visible).toBe(true);
  });

  it('shows the lines while crosshairs is active and restores off afterwards', () => {
    const store = useReferenceLinesStore();
    const toolStore = useToolStore();

    expect(store.visible).toBe(false);

    toolStore.setCurrentTool(Tools.Crosshairs);
    expect(store.visible).toBe(true);

    toolStore.setCurrentTool(Tools.Pan);
    expect(store.visible).toBe(false);
  });

  it('keeps the lines on across a crosshairs session when the setting is on', () => {
    const store = useReferenceLinesStore();
    const toolStore = useToolStore();
    store.enabled = true;

    toolStore.setCurrentTool(Tools.Crosshairs);
    expect(store.visible).toBe(true);

    toolStore.setCurrentTool(Tools.Pan);
    expect(store.visible).toBe(true);
  });

  it('follows temporary crosshairs activation and deactivation', () => {
    const store = useReferenceLinesStore();
    const toolStore = useToolStore();
    toolStore.setCurrentTool(Tools.Pan);

    toolStore.activateTemporaryCrosshairs();
    expect(store.visible).toBe(true);

    toolStore.deactivateTemporaryCrosshairs();
    expect(store.visible).toBe(false);
  });

  it('persists the setting to localStorage', async () => {
    const store = useReferenceLinesStore();

    store.enabled = true;
    await nextTick();

    setActivePinia(createPinia());
    expect(useReferenceLinesStore().enabled).toBe(true);
  });
});
