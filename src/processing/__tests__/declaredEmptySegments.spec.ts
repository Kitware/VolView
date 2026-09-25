import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import type { SegmentDescriptor } from '@/backend-contract';
import {
  applyIntent,
  appApplyDependencies,
} from '@/src/processing/applyResults';
import { segmentRenderMask } from '@/src/segmentation/rendering/renderMask';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import {
  parentImage,
  seatImage,
  type Index3,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { savedMasks, serializeScene } from './serializedScene';

const GRID = { dimensions: [4, 4, 4] as Index3 };
const LIVER_INDEX: Index3 = [1, 1, 1];
const red = [255, 0, 0, 255] as [number, number, number, number];
const blue = [0, 0, 255, 255] as [number, number, number, number];

const DECLARED: SegmentDescriptor[] = [
  { value: 1, name: 'Liver', color: red },
  { value: 2, name: 'Spleen', color: blue },
];

const importResult = (segments: SegmentDescriptor[]) =>
  applyIntent(
    {
      intent: 'import-segmentation',
      id: 'result',
      name: 'output.nrrd',
      url: 'https://example/output.nrrd',
      segments,
      source: { providerId: 'provider', jobId: 'job', outputId: 'mask' },
    },
    {
      jobId: 'job',
      taskId: 'task',
      providerId: 'provider',
      submittedAt: '',
      activeDatasetId: 'parent',
    },
    {
      ...appApplyDependencies(),
      importVolume: async () => 'output',
      removeDataset: (id) => useImageCacheStore().removeImage(id),
    }
  );

const rowsOf = (
  saved: Awaited<ReturnType<typeof serializeScene>>,
  imageId: string
) =>
  savedMasks(saved, imageId).map(({ segment, extent, artifact }) => ({
    name: segment!.name,
    color: segment!.color,
    visible: segment!.visible,
    extent,
    artifact,
  }));

const save = (imageId = 'parent') => serializeScene([imageId]);

const LIVER_ROW = {
  name: 'Liver',
  color: red,
  visible: true,
  extent: [1, 1, 1, 1, 1, 1],
  artifact: { dimensions: [1, 1, 1], values: [1] },
};
const EMPTY_SPLEEN_ROW = {
  name: 'Spleen',
  color: blue,
  visible: true,
  extent: [0, -1, 0, -1, 0, -1],
  artifact: { dimensions: [1, 1, 1], values: [0] },
};

const liverOffset = () =>
  LIVER_INDEX[0] + LIVER_INDEX[1] * 4 + LIVER_INDEX[2] * 16;

/** Only value 1 is written, so value 2 is declared and never filled. */
async function seatScene() {
  await seatImage('parent', { ...GRID, name: 'CT' });
  const values = new Uint8Array(64);
  values[liverOffset()] = 1;
  await seatImage('output', { ...GRID, name: 'output.nrrd', values });
}

describe('a segment a result declares but leaves empty', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatScene();
  });

  it('appears as an empty row beside the segment that has voxels', async () => {
    expect(await importResult(DECLARED)).toEqual({ status: 'applied' });

    expect(rowsOf(await save(), 'parent')).toEqual([
      LIVER_ROW,
      EMPTY_SPLEEN_ROW,
    ]);
  });

  it('draws nothing for the empty segment', async () => {
    await importResult(DECLARED);

    const saved = await save();
    const binding =
      saved.manifest.segmentations![0].masks[1].representations.labelmap!;
    const entry = saved.stateFiles.find(
      ({ archivePath }) => archivePath === binding.path
    )!;
    const { image } = await saved.io.read(entry.file);
    expect(
      segmentRenderMask(image, parentImage('parent'), binding.extent, {
        axis: 2,
        index: 1,
      })
    ).toBeNull();
  });

  it.each([0, 1])(
    'mints no empty twin for a value only component %i carries',
    async (component) => {
      // A value with voxels in one component and none in the other is not a
      // declaration left empty: some component found it. Only the value no
      // component carries becomes a row of its own.
      const values = new Uint8Array(128);
      values[liverOffset() * 2 + component] = 1;
      useImageCacheStore()
        .getVtkImageData('output')!
        .getPointData()
        .setScalars(
          vtkDataArray.newInstance({ numberOfComponents: 2, values })
        );

      expect(await importResult(DECLARED)).toEqual({ status: 'applied' });

      expect(rowsOf(await save(), 'parent')).toEqual([
        LIVER_ROW,
        EMPTY_SPLEEN_ROW,
      ]);
    }
  );

  it('keeps both segments across a save and restore', async () => {
    await importResult(DECLARED);
    const saved = await save();
    const before = rowsOf(saved, 'parent');
    expect(before).toEqual([LIVER_ROW, EMPTY_SPLEEN_ROW]);

    setActivePinia(createPinia());
    await seatImage('new-parent', { ...GRID, name: 'CT' });
    const result = await useSegmentationStore().deserialize({
      manifest: saved.manifest,
      stateFiles: saved.stateFiles,
      dataIDMap: { parent: 'new-parent' },
      segmentIdMap: useSegmentStore().deserialize(saved.manifest).segmentIdMap,
      io: saved.io,
    });
    await nextTick();

    expect(result.skipped).toEqual([]);
    expect(rowsOf(await save('new-parent'), 'new-parent')).toEqual(before);
  });
});
