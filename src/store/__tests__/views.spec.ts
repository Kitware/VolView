import { describe, it, beforeEach, expect } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useViewStore } from '@/src/store/views';
import { computeEffectiveView } from '@/src/core/views/effectiveView';
import { markCine } from '@/src/core/cine/__tests__/cineFixtures';
import type { Manifest } from '@/src/io/state-file/schema';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useViewCameraStore } from '@/src/store/view-configs/camera';
import { useImageStatsStore } from '@/src/store/image-stats';
import { useViewConfigStore } from '@/src/store/view-configs';
import { useSyncWindowing } from '@/src/composables/useSyncWindowing';

describe('View store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    markCine('cine-image');
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

  it.each([false, true])(
    'clears projection ranges and camera state when a session reuses a replaced view ID (replace before restore=%s)',
    (replaceBeforeRestore) => {
      const store = useViewStore();
      store.replaceView(store.layoutViews[0].id, {
        name: 'En face',
        type: 'EnFace',
        dataID: 'image',
        options: {},
      });
      const id = store.layoutViews[0].id;
      const windowing = useWindowingStore();
      const range: [number, number] = [5000, 100000];
      windowing.setAutoRangeValues(id, 'image', {
        FullRange: range,
        LowContrast: range,
        MediumContrast: range,
        HighContrast: range,
      });
      const cameras = useViewCameraStore();
      cameras.markCameraAsInitialized(id, 'image');
      useImageStatsStore().stats.image = {
        scalarMin: 0,
        scalarMax: 255,
        autoRangeValues: {
          FullRange: [0, 255],
          LowContrast: [0, 255],
          MediumContrast: [0, 255],
          HighContrast: [0, 255],
        },
      };
      const manifest: Manifest = {
        version: '7.0.0',
        dataSources: [],
        viewByID: {
          [id]: {
            id,
            name: 'Axial',
            type: '2D',
            dataID: 'saved-image',
            options: { orientation: 'Axial' },
          },
        },
      };

      if (replaceBeforeRestore)
        store.replaceView(id, {
          name: 'Axial',
          type: '2D',
          dataID: 'image',
          options: { orientation: 'Axial' },
        });

      store.deserializeLayout(manifest);
      store.bindViewsToData('saved-image', 'image', manifest);
      windowing.resetContrast(id, 'image');

      expect(store.getView(id)?.type).toBe('2D');
      expect(windowing.getRange(id, 'image')).toEqual([0, 255]);
      expect(windowing.getConfig(id, 'image')).toMatchObject({
        width: 255,
        level: 127.5,
      });
      expect(cameras.isCameraInitialized(id, 'image')).toBe(false);
    }
  );

  it('keeps edited source contrast when replacing a source pane after configuration has been saved', () => {
    const views = useViewStore();
    useViewConfigStore();
    useSyncWindowing();
    const oldID = views.layoutViews[0].id;
    views.setDataForView(oldID, 'image');
    const windowing = useWindowingStore();
    windowing.updateConfig(oldID, 'image', { width: 37, level: 12 }, true);

    views.replaceView(oldID, {
      name: 'Coronal',
      type: '2D',
      dataID: 'image',
      options: { orientation: 'Coronal' },
    });

    expect(windowing.getConfig(views.layoutViews[0].id, 'image')).toMatchObject(
      {
        width: 37,
        level: 12,
        useAuto: false,
      }
    );
    expect(windowing.getInternalConfig(oldID, 'image')).toBeUndefined();
  });
});

describe('View store layoutViews', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('lists every layout slot view, in slot order', () => {
    const store = useViewStore();

    expect(store.layoutViews.map((view) => view.name)).toEqual([
      'Axial',
      'Coronal',
      'Sagittal',
      'Volume',
    ]);
  });

  it('drops views the layout no longer has a slot for', () => {
    const store = useViewStore();
    const allIds = store.layoutViews.map((view) => view.id);

    store.setLayoutFromGrid([1, 1]);

    expect(store.layoutViews.map((view) => view.id)).toEqual([allIds[0]]);
    // The orphaned views survive so a later layout switch can reuse them.
    expect(store.viewIDs).toEqual(expect.arrayContaining(allIds));

    store.setLayoutFromGrid([2, 2]);

    expect(store.layoutViews.map((view) => view.id)).toEqual(allIds);
  });

  it('keeps hidden layout peers while a view is maximized', () => {
    const store = useViewStore();
    const allIds = store.layoutViews.map((view) => view.id);
    expect(allIds.length).toBeGreaterThan(1);

    store.setActiveView(allIds[0]);
    store.toggleActiveViewMaximized();

    expect(store.visibleViews).toHaveLength(1);
    expect(store.layoutViews.map((view) => view.id)).toEqual(allIds);
  });
});
