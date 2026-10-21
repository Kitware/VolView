import { expect, it } from 'vitest';
import { nextTick } from 'vue';
import JSZip from 'jszip';
import { createStateFileRestorer } from '@/src/io/import/processors/restoreStateFile';
import { MANIFEST, serialize } from '@/src/io/state-file/serialize';
import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import {
  activateAppPinia,
  seatImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { seatDataSource } from '@/src/store/__tests__/datasetFixtures';
import { useImageStatsStore } from '@/src/store/image-stats';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useViewStore } from '@/src/store/views';
import { useLayerColoringStore } from '@/src/store/view-configs/layers';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useViewCameraStore } from '@/src/store/view-configs/camera';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { useSyncWindowing } from '@/src/composables/useSyncWindowing';
import { getLayerId } from '@/src/utils/layers';

function seatStatistics(id: string) {
  useImageStatsStore().stats[id] = {
    scalarMin: 0,
    scalarMax: 100,
    autoRangeValues: {},
  };
}

async function loadImages(base: string, overlay: string) {
  activateAppPinia();
  for (const id of [base, overlay]) {
    seatStatistics(id);
    await seatImage(id, {
      dimensions: [2, 2, 2],
      values: Float32Array.from([0, 20, 30, 40, 50, 60, 80, 100]),
    });
    seatDataSource(id, { type: 'uri', uri: `/${id}.nrrd`, name: `${id}.nrrd` });
  }
  seatStatistics(getLayerId(base, overlay));
}

const views2D = () =>
  useViewStore()
    .getAllViews()
    .filter((view) => view.type === '2D');

async function prepareScene() {
  await loadImages('base', 'overlay');
  const layerID = (await useLayersStore()._addLayer('base', 'overlay'))!;
  useViewStore().setDataForAllViews('base');
  const coloring = useLayerColoringStore();
  views2D().forEach((view) => coloring.getConfig(view.id, layerID));
  coloring.updateDisplayConfig(layerID, { opacity: 0.8 });
  const retainedView = views2D()[1];
  useWindowingStore().updateConfig(retainedView.id, 'base', {
    width: 40,
    level: 25,
    useAuto: false,
  });
  return { layerID, retainedView };
}

async function exportManifest() {
  const archive = await JSZip.loadAsync(await serialize());
  const json = await archive.file(MANIFEST)!.async('string');
  return ManifestSchema.parse(JSON.parse(json));
}

async function restoreManifest(manifest: Manifest) {
  await loadImages('restoredBase', 'restoredOverlay');
  const views = useViewStore();
  views.deserializeLayout(manifest);
  await createStateFileRestorer()(manifest, [], {
    base: 'restoredBase',
    overlay: 'restoredOverlay',
  });
  const layerID = (await useLayersStore()._addLayer(
    'restoredBase',
    'restoredOverlay'
  ))!;
  views.switchToNamedLayout('Four Up');
  views.visibleViews
    .filter((view) => view.type === '2D')
    .forEach((view) => useLayerColoringStore().getConfig(view.id, layerID));
  return layerID;
}

it.each([false, true])(
  'drops removed overlay settings from repeated saves (re-added: %s)',
  async (readd) => {
    const { layerID, retainedView } = await prepareScene();
    await exportManifest();
    const views = useViewStore();
    views.switchToNamedLayout('Axial Only');
    const layers = useLayersStore();
    layers.deleteLayer('base', 'overlay');
    await nextTick();
    if (readd) {
      seatStatistics(layerID);
      await layers._addLayer('base', 'overlay');
      useLayerColoringStore().getConfig(views.visibleViews[0].id, layerID);
    }

    const saved = await exportManifest();
    const savedViewConfig = saved.viewByID![retainedView.id].config!;
    expect(savedViewConfig[layerID]?.layers).toBeUndefined();
    expect(savedViewConfig.base.window).toMatchObject({ width: 40, level: 25 });
    if (!readd) {
      expect(saved.layerDisplay?.[layerID]).toBeUndefined();
      expect(saved.parentToLayers![0].sourceSelectionKeys).toEqual([]);
      return;
    }

    const restoredLayerID = await restoreManifest(saved);
    const reexported = await exportManifest();
    expect(reexported.layoutSlots).toContain(retainedView.id);
    expect(
      Object.values(reexported.viewByID!)
        .filter((view) => view.type === '2D')
        .map(
          (view) => view.config![restoredLayerID].layers!.blendConfig.opacity
        )
    ).toEqual([0.3, 0.3, 0.3]);
    expect(reexported.layerDisplay![restoredLayerID].opacity).toBe(0.3);
    expect(
      reexported.viewByID![retainedView.id].config!.restoredBase.window
    ).toMatchObject({ width: 40, level: 25 });
  }
);

it('preserves current per-view appearance and other view settings across repeated saves', async () => {
  const { layerID, retainedView } = await prepareScene();
  const coloring = useLayerColoringStore();
  const original = coloring.getConfig(retainedView.id, layerID);
  coloring.deserialize(retainedView.id, {
    [layerID]: {
      layers: {
        ...original,
        blendConfig: { opacity: 0.65, visibility: false },
      },
    },
  });
  await exportManifest();
  useViewStore().switchToNamedLayout('Axial Only');
  const saved = await exportManifest();
  const restoredLayerID = await restoreManifest(saved);
  const reexported = await exportManifest();
  const restoredViewConfig = reexported.viewByID![retainedView.id].config!;

  expect(restoredViewConfig[restoredLayerID].layers!.blendConfig).toEqual({
    opacity: 0.65,
    visibility: false,
  });
  expect(reexported.layerDisplay![restoredLayerID].opacity).toBe(0.8);
  expect(restoredViewConfig.restoredBase.window).toMatchObject({
    width: 40,
    level: 25,
  });
});

it('saves reset base appearance without losing retained slice and camera settings', async () => {
  await loadImages('base', 'overlay');
  useSyncWindowing();
  const views = useViewStore();
  views.setDataForAllViews('base');
  views.switchToNamedLayout('Oblique');
  const obliqueView = views.visibleViews[0];
  const retainedView = views2D()[0];
  useViewSliceStore().updateConfig(retainedView.id, 'base', { slice: 0 });
  useViewCameraStore().updateConfig(retainedView.id, 'base', {
    parallelScale: 2,
  });
  const windowing = useWindowingStore();
  windowing.updateConfig(obliqueView.id, 'base', {
    preset: 'DICOM PET',
    visibility: false,
    width: 40,
    level: 25,
  });
  const beforeReset = await exportManifest();
  expect(
    beforeReset.viewByID![obliqueView.id].config!.base.window
  ).toMatchObject({
    preset: 'DICOM PET',
    visibility: false,
  });

  windowing.resetConfig(obliqueView.id, 'base');
  const saved = await exportManifest();
  expect(saved.viewByID![obliqueView.id].config?.base?.window).toBeUndefined();

  await loadImages('restoredBase', 'restoredOverlay');
  useSyncWindowing();
  useViewStore().deserializeLayout(saved);
  await createStateFileRestorer()(saved, [], {
    base: 'restoredBase',
    overlay: 'restoredOverlay',
  });
  const restored = await exportManifest();
  expect(
    restored.viewByID![obliqueView.id].config!.restoredBase.window
  ).toMatchObject({
    preset: 'Grayscale',
    visibility: true,
    width: 100,
    level: 50,
  });
  expect(
    restored.viewByID![retainedView.id].config!.restoredBase
  ).toMatchObject({
    slice: { slice: 0 },
    camera: { parallelScale: 2 },
  });
});
