import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useViewStore } from '@/src/store/views';
import { useViewConfigStore } from '@/src/store/view-configs';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useViewCameraStore } from '@/src/store/view-configs/camera';
import { useVolumeColoringStore } from '@/src/store/view-configs/volume-coloring';
import { useCinePlaybackStore } from '@/src/store/view-configs/cine-playback';
import { useEnFaceViewStore } from '@/src/enface/store';
import { useImageStore } from '@/src/store/datasets-images';
import { useDatasetStore } from '@/src/store/datasets';
import { useImageStatsStore } from '@/src/store/image-stats';
import '@/src/vtk/ColorMaps';
import { useSyncWindowing } from '@/src/composables/useSyncWindowing';
import { makeImage } from '@/src/segmentation/__tests__/segmentMaskFixtures';

const configStores = () => ({
  slice: useViewSliceStore(),
  window: useWindowingStore(),
  camera: useViewCameraStore(),
  volume: useVolumeColoringStore(),
  cine: useCinePlaybackStore(),
  enFace: useEnFaceViewStore(),
});

const seatImage = (id: string) => {
  const image = makeImage({ dimensions: [2, 2, 12] });
  useImageStatsStore().stats[id] = {
    scalarMin: 0,
    scalarMax: 0,
    autoRangeValues: {},
  };
  useImageStore().addVTKImageData(id, image, { id });
};

const seedConfigs = (viewID: string, dataID = 'image') => {
  const stores = configStores();
  stores.slice.updateConfig(viewID, dataID, { slice: 7, min: 0, max: 11 });
  stores.window.updateConfig(viewID, dataID, {
    width: 120,
    level: 60,
    useAuto: false,
  });
  stores.camera.updateConfig(viewID, dataID, {
    position: [1, 2, 3],
    focalPoint: [4, 5, 6],
    parallelScale: 14,
  });
  stores.camera.markCameraAsInitialized(viewID, dataID);
  stores.volume.updateColorTransferFunction(viewID, dataID, {
    mappingRange: [10, 80],
  });
  stores.cine.updateConfig(viewID, dataID, {
    frame: 1,
    fps: 30,
    playing: true,
  });
  Object.assign(stores.enFace.configFor(viewID, dataID), {
    method: 'max',
    depthStart: 2,
    depthEnd: 9,
  });
  stores.enFace.patchSegment(viewID, dataID, 'segment', {
    visible: true,
    thresholdMicrons: 40,
  });
  return stores;
};

const seedDatasetHistory = (viewID: string) => {
  useViewStore().setDataForView(viewID, 'image');
  const stores = seedConfigs(viewID);
  seedConfigs(viewID, 'other-image');
  return stores;
};

describe('view configuration lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useViewConfigStore();
    seatImage('image');
    seatImage('other-image');
  });

  it('copies dataset history into a split with independent nested configs', () => {
    const views = useViewStore();
    const source = views.layoutViews[0].id;
    const stores = seedDatasetHistory(source);

    const target = views.splitView(source, 'row')!;

    for (const store of [
      stores.slice,
      stores.window,
      stores.camera,
      stores.volume,
      stores.enFace,
    ]) {
      expect(store.configs[target]).toEqual(store.configs[source]);
      expect(store.configs[target]).not.toBe(store.configs[source]);
    }
    expect(stores.camera.isCameraInitialized(target, 'image')).toBe(true);
    stores.camera.configs[target].image.position![0] = 42;
    stores.volume.configs[target].image.transferFunction.mappingRange[0] = 99;

    expect(stores.camera.configs[source].image.position).toEqual([1, 2, 3]);
    expect(
      stores.volume.configs[source].image.transferFunction.mappingRange
    ).toEqual([10, 80]);
    stores.enFace.patchSegment(target, 'image', 'segment', { visible: false });
    expect(
      stores.enFace.configs[source].image.segmentProjections.segment.visible
    ).toBe(true);
    stores.slice.updateConfig(target, 'image', { slice: 3 });
    expect(stores.slice.getConfig(source, 'image').slice).toBe(7);
    expect(views.getView(target)?.dataID).toBe('image');
  });

  it('copies the cine frame and rate with playback paused', () => {
    const views = useViewStore();
    const source = views.layoutViews[0].id;
    const { cine } = seedConfigs(source);

    const target = views.splitView(source, 'column')!;

    expect(cine.getConfig(target, 'image')).toEqual({
      frame: 1,
      fps: 30,
      playing: false,
    });
    expect(cine.getConfig(source, 'image').playing).toBe(true);
  });

  it('clears every config and camera initialization immediately when a view closes', () => {
    const views = useViewStore();
    const source = views.layoutViews[0].id;
    const stores = seedConfigs(source);
    const retained = views.layoutViews[1].id;
    seedConfigs(retained);
    const target = views.splitView(source, 'row')!;

    expect(views.closeView(source)).toBe(true);

    Object.values(stores).forEach((store) => {
      expect(store.configs[source]).toBeUndefined();
      expect(store.configs[target]).toBeDefined();
      expect(store.configs[retained]).toBeDefined();
    });
    expect(stores.camera.isCameraInitialized(source, 'image')).toBe(false);
    expect(stores.camera.isCameraInitialized(target, 'image')).toBe(true);
  });

  it('clears replaced configs after transferring the current windowing', () => {
    const views = useViewStore();
    const source = views.layoutViews[0].id;
    views.setDataForView(source, 'image');
    const stores = seedConfigs(source);

    useSyncWindowing();
    views.replaceView(source, {
      name: 'Volume',
      type: '3D',
      dataID: 'image',
      options: { viewDirection: 'Posterior', viewUp: 'Superior' },
    });

    Object.values(stores).forEach((store) =>
      expect(store.configs[source]).toBeUndefined()
    );
    expect(stores.camera.isCameraInitialized(source, 'image')).toBe(false);
    const replacement = views.layoutViews[0].id;
    expect(stores.window.getConfig(replacement, 'image')).toMatchObject({
      width: 120,
      level: 60,
      useAuto: false,
    });
  });

  it('copies and removes the synthetic renderer configs owned by an oblique view', () => {
    const views = useViewStore();
    const source = views.layoutViews[0].id;
    views.replaceView(source, {
      name: 'Oblique',
      type: 'Oblique',
      dataID: 'image',
      options: {},
    });
    const oblique = views.layoutViews[0].id;
    const suffixes = ['-axial', '-coronal', '-sagittal', '-multi-oblique'];
    const stores = configStores();
    suffixes.forEach((suffix) => seedConfigs(oblique + suffix));

    const target = views.splitView(oblique, 'column')!;

    suffixes.forEach((suffix) => {
      expect(stores.camera.configs[target + suffix]).toEqual(
        stores.camera.configs[oblique + suffix]
      );
      expect(stores.camera.isCameraInitialized(target + suffix, 'image')).toBe(
        true
      );
    });
    views.closeView(oblique);
    suffixes.forEach((suffix) => {
      Object.values(stores).forEach((store) => {
        expect(store.configs[oblique + suffix]).toBeUndefined();
        expect(store.configs[target + suffix]).toBeDefined();
      });
      expect(stores.camera.isCameraInitialized(oblique + suffix, 'image')).toBe(
        false
      );
    });
  });

  it('clears old renderer configs before restoring a session with reused view IDs', () => {
    const views = useViewStore();
    const source = views.layoutViews[0].id;
    const stores = seedConfigs(source);
    seedConfigs(source + '-axial');
    const split = views.splitView(source, 'row')!;

    views.deserializeLayout({
      version: '6.1.0',
      dataSources: [],
      layout: { direction: 'row', items: [{ type: 'view', viewId: source }] },
      activeView: source,
      viewByID: {
        [source]: {
          id: source,
          name: 'Axial',
          type: '2D',
          dataID: 'saved-image',
          options: { orientation: 'Axial' },
          config: { 'saved-image': { camera: { position: [8, 9, 10] } } },
        },
      },
    });
    Object.values(stores).forEach((store) => {
      expect(store.configs[source]).toBeUndefined();
      expect(store.configs[source + '-axial']).toBeUndefined();
      expect(store.configs[split]).toBeUndefined();
    });
    expect(stores.camera.isCameraInitialized(source, 'image')).toBe(false);
    useViewConfigStore().deserialize(
      source,
      {
        'saved-image': { camera: { position: [8, 9, 10] } },
      },
      { 'saved-image': 'other-image' },
      () => undefined
    );

    expect(stores.camera.getConfig(source, 'other-image')?.position).toEqual([
      8, 9, 10,
    ]);
    expect(stores.camera.isCameraInitialized(source, 'other-image')).toBe(true);
    expect(stores.camera.getConfig(source, 'image')).toBeUndefined();
  });

  it('removes deleted image configs from split peers and keeps another image history', () => {
    const views = useViewStore();
    const source = views.layoutViews[0].id;
    const stores = seedDatasetHistory(source);
    const target = views.splitView(source, 'row')!;

    useDatasetStore().remove('image');

    [source, target].forEach((id) => {
      expect(views.getView(id)?.dataID).toBeNull();
      Object.values(stores).forEach((store) => {
        expect(store.configs[id].image).toBeUndefined();
        expect(store.configs[id]['other-image']).toBeDefined();
      });
      expect(stores.camera.isCameraInitialized(id, 'image')).toBe(false);
    });
  });

  const layoutIDs = () => useViewStore().layoutViews.map(({ id }) => id);

  it('deletes every view and its settings when a named layout is picked', () => {
    const views = useViewStore();
    const fourUp = layoutIDs();
    const stores = configStores();
    fourUp.forEach((id) => seedConfigs(id));

    views.switchToNamedLayout('Four Up');

    const picked = layoutIDs();
    expect(picked).toHaveLength(4);
    expect(views.viewIDs).toEqual(expect.arrayContaining(picked));
    expect(views.viewIDs).toHaveLength(4);
    fourUp.forEach((id) => {
      expect(picked).not.toContain(id);
      Object.values(stores).forEach((store) =>
        expect(store.configs[id]).toBeUndefined()
      );
    });
  });
});
