import { describe, it, beforeEach, expect, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useViewStore } from '@/src/store/views';
import { computeEffectiveView } from '@/src/core/views/effectiveView';
import type { Manifest } from '@/src/io/state-file/schema';

vi.mock('@/src/core/cine/isCineImage', () => ({
  isCineImage: (imageID: string | null) => imageID === 'cine-image',
  getCineImage: () => null,
}));

describe('View store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('selects the first initial visible view', () => {
    const store = useViewStore();

    expect(store.activeView).toBe(store.visibleViews[0].id);
  });

  it('selects a visible view when data is attached to the default layout', () => {
    const store = useViewStore();

    store.setActiveView(null);
    store.setDataForAllViews('image-1');

    expect(store.activeView).toBe(store.visibleViews[0].id);
  });

  it('preserves stored view types when cine data is attached', () => {
    const store = useViewStore();

    const storedTypes = store.visibleViews.map((view) => view.type);
    store.setDataForAllViews('cine-image');

    expect(store.visibleViews).toHaveLength(4);
    store.visibleViews.forEach((view, idx) => {
      expect(view.type).toBe(storedTypes[idx]);
      expect(view.dataID).toBe('cine-image');
      expect(computeEffectiveView(view, view.dataID).kind).toBe('cine');
    });
  });

  it('keeps the original view when cine binds to a 3D slot', () => {
    const store = useViewStore();
    const volumeView = store.visibleViews.find((view) => view.type === '3D')!;

    store.setActiveView(volumeView.id);
    store.setDataForView(volumeView.id, 'cine-image');

    const preserved = store.getView(volumeView.id)!;
    expect(preserved.type).toBe('3D');
    expect(preserved.dataID).toBe('cine-image');
    expect(computeEffectiveView(preserved, preserved.dataID).kind).toBe('cine');
    expect(store.activeView).toBe(volumeView.id);
  });

  it('selects a visible view when session data IDs are rebound', () => {
    const store = useViewStore();
    const manifest: Manifest = {
      version: '6.1.0',
      dataSources: [],
      activeView: null,
      layout: {
        direction: 'column',
        items: [{ type: 'slot', slotIndex: 0 }],
      },
      layoutSlots: ['view-1'],
      viewByID: {
        'view-1': {
          id: 'view-1',
          type: '2D',
          dataID: 'state-image',
          name: 'Axial',
          options: {
            orientation: 'Axial',
          },
        },
      },
    };

    store.deserializeLayout(manifest);
    expect(store.activeView).toBeNull();

    store.bindViewsToData('state-image', 'loaded-image', manifest);

    expect(store.activeView).toBe('view-1');
    expect(store.viewByID['view-1'].dataID).toBe('loaded-image');
  });
});
