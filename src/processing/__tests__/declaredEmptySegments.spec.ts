import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import type { SegmentDescriptor } from '@/backend-contract';
import {
  applyIntent,
  appApplyDependencies,
} from '@/src/processing/applyResults';
import { useImageCacheStore } from '@/src/store/image-cache';
import { deserializeSegmentation } from '@/src/segmentation/io/stateFile';
import { useSegmentStore } from '@/src/segmentation/segments';
import {
  bindMasks,
  deleteSegment,
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
) => {
  const masks = savedMasks(saved, imageId);
  const set = saved.manifest.imageSegments?.find(
    (entry) => entry.imageId === imageId
  );
  return (set?.segments ?? []).map((segment) => {
    const mask = masks.find(({ segmentId }) => segmentId === segment.id);
    return {
      name: segment.name,
      color: segment.color,
      visible: segment.visible,
      extent: mask?.extent,
      artifact: mask?.artifact,
    };
  });
};

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
  extent: undefined,
  artifact: undefined,
};

const liverOffset = () =>
  LIVER_INDEX[0] + LIVER_INDEX[1] * 4 + LIVER_INDEX[2] * 16;

/** Only value 1 is written, so value 2 is declared and never filled. */
const outputValues = () => {
  const values = new Uint8Array(64);
  values[liverOffset()] = 1;
  return values;
};

async function seatScene() {
  await seatImage('parent', { ...GRID, name: 'CT' });
  await seatImage('output', {
    ...GRID,
    name: 'output.nrrd',
    values: outputValues(),
  });
}

describe('a segment a result declares but leaves empty', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatScene();
  });

  it('appears as a segment without a mask beside the one that has voxels', async () => {
    expect(await importResult(DECLARED)).toEqual({ status: 'applied' });

    expect(rowsOf(await save(), 'parent')).toEqual([
      LIVER_ROW,
      EMPTY_SPLEEN_ROW,
    ]);
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

  it('leaves a painted segment of the same name out of the result', async () => {
    bindMasks('parent', ['Spleen']);
    await importResult(DECLARED);
    deleteSegment(
      useSegmentStore().segments.findSegmentByName('parent', 'Liver')!.id
    );
    // Applying a result removes the image it arrived in.
    await seatImage('output', {
      ...GRID,
      name: 'output.nrrd',
      values: outputValues(),
    });

    expect(await importResult(DECLARED)).toEqual({ status: 'applied' });

    const saved = await save();
    expect(rowsOf(saved, 'parent').map(({ name }) => name)).toEqual([
      'Spleen',
      'Liver',
    ]);
    expect(
      savedMasks(saved, 'parent').find(
        ({ segment }) => segment.name === 'Spleen'
      )?.source
    ).toBeUndefined();
  });

  it('keeps both segments across a save and restore', async () => {
    await importResult(DECLARED);
    const saved = await save();
    const before = rowsOf(saved, 'parent');
    expect(before).toEqual([LIVER_ROW, EMPTY_SPLEEN_ROW]);

    setActivePinia(createPinia());
    await seatImage('new-parent', { ...GRID, name: 'CT' });
    const result = await deserializeSegmentation({
      manifest: saved.manifest,
      stateFiles: saved.stateFiles,
      dataIDMap: { parent: 'new-parent' },
      resolveSegment: useSegmentStore().deserialize(saved.manifest, {
        parent: 'new-parent',
      }),
      io: saved.io,
    });
    await nextTick();

    expect(result.skipped).toEqual([]);
    expect(rowsOf(await save('new-parent'), 'new-parent')).toEqual(before);
  });
});
