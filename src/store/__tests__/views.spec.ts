import { describe, it, beforeEach, expect, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useViewStore } from '@/src/store/views';
import type { Manifest } from '@/src/io/state-file/schema';

vi.mock('@/src/core/cine/isCineImage', () => ({
  isCineImage: (imageID: string | null) => imageID === 'cine-image',
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

  it('replaces non-2D views with axial views when cine data is attached', () => {
    const store = useViewStore();

    store.setDataForAllViews('cine-image');

    expect(store.visibleViews).toHaveLength(4);
    store.visibleViews.forEach((view) => {
      expect(view.type).toBe('2D');
      expect(view.dataID).toBe('cine-image');
    });

    expect(store.visibleViews[3]).toMatchObject({
      type: '2D',
      name: 'Axial',
      options: {
        orientation: 'Axial',
      },
    });
  });

  it('keeps the active view on cine replacement', () => {
    const store = useViewStore();
    const volumeView = store.visibleViews.find((view) => view.type === '3D')!;

    store.setActiveView(volumeView.id);
    store.setDataForView(volumeView.id, 'cine-image');

    expect(store.getView(volumeView.id)).toBeNull();
    expect(store.activeView).not.toBe(volumeView.id);
    expect(store.getView(store.activeView)).toMatchObject({
      type: '2D',
      dataID: 'cine-image',
      options: {
        orientation: 'Axial',
      },
    });
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
