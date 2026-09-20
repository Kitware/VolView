import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import type { SegmentDescriptor } from '@/backend-contract';
import {
  applyIntent,
  appApplyDependencies,
} from '@/src/processing/applyResults';
import { buildSegNrrdMetadata } from '@/src/io/segNrrdMetadata';
import { isEmptyExtent } from '@/src/segmentation/geometry';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { usePolygonStore } from '@/src/store/tools/polygons';
import {
  seatImage,
  seedVoxel,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

const registry = () => useSegmentStore().segments;
const store = () => useSegmentationStore();
const source = { providerId: 'provider', jobId: 'job', outputId: 'mask' };
const blue = [0, 0, 255, 255] as [number, number, number, number];
const red = [255, 0, 0, 255] as [number, number, number, number];

const existingMask = (imageId: string, name: string) => {
  const segmentId = registry().mintSegment({ name, color: red });
  const maskId = store().resolveEditTarget(imageId, segmentId);
  seedVoxel(maskId, [1, 1, 1]);
  return { segmentId, maskId };
};

const importResult = (segments?: SegmentDescriptor[]) =>
  applyIntent(
    {
      intent: 'import-segmentation',
      id: 'result',
      name: 'output.nrrd',
      url: 'https://example/output.nrrd',
      segments,
      source,
    },
    {
      jobId: 'job',
      taskId: 'task',
      providerId: 'provider',
      submittedAt: '',
      activeDatasetId: 'parent-B',
    },
    {
      ...appApplyDependencies(),
      importVolume: async () => 'output',
      removeDataset: (id) => useImageCacheStore().removeImage(id),
    }
  );

const appearanceOnB = () =>
  store()
    .imageMasks('parent-B')
    .map(({ segmentId }) => registry().appearanceOf(segmentId));

beforeEach(async () => {
  setActivePinia(createPinia());
  await seatImage('parent-A');
  await seatImage('parent-B');
  const values = new Uint8Array(64);
  values[21] = 1;
  await seatImage('output', { name: 'output.nrrd', values });
});

describe('processing segment identity', () => {
  it("does not change another image's type named after the output file", async () => {
    const { segmentId, maskId } = existingMask('parent-A', 'output');
    const toolId = usePolygonStore().addTool({
      imageID: 'parent-A',
      segmentId,
    });
    const before = registry().appearanceOf(segmentId);

    expect(
      await importResult([{ value: 1, name: 'Liver', color: blue }])
    ).toEqual({ status: 'applied' });

    expect(registry().appearanceOf(segmentId)).toEqual(before);
    expect(store().getMask(maskId).segmentId).toBe(segmentId);
    expect(usePolygonStore().toolByID[toolId].segmentId).toBe(segmentId);
    expect(appearanceOnB()).toMatchObject([{ name: 'Liver', color: blue }]);
    const mask = store().imageMasks('parent-B')[0];
    expect(mask.representations.labelmap?.extent).toEqual([1, 1, 1, 1, 1, 1]);
    expect(mask.representations.labelmap?.source).toEqual(source);
  });

  it('reuses the declared type across images and keeps its existing appearance', async () => {
    const { segmentId } = existingMask('parent-A', 'Tumor');
    registry().updateSegment(segmentId, { visible: false, locked: true });

    await importResult([
      { value: 1, name: 'Tumor', color: blue, visible: true },
    ]);

    expect(store().imageMasks('parent-B')[0].segmentId).toBe(segmentId);
    expect(appearanceOnB()).toMatchObject([
      { name: 'Tumor', color: red, visible: false, locked: true },
    ]);
    expect(registry().segmentList.value).toHaveLength(1);
  });

  it('uses a distinct type when the declared type already has a mask on the target', async () => {
    const { segmentId, maskId } = existingMask('parent-B', 'Tumor');

    await importResult([{ value: 1, name: 'Tumor', color: blue }]);

    expect(store().getMask(maskId).segmentId).toBe(segmentId);
    expect(appearanceOnB()).toMatchObject([
      { name: 'Tumor', color: red },
      { name: 'Tumor (2)', color: blue },
    ]);
  });

  it('overrides embedded names, keeps undescribed source values, and keeps a declared empty', async () => {
    existingMask('parent-A', 'Embedded');
    const output = useImageCacheStore().imageById.output;
    output.headerMetadata = buildSegNrrdMetadata(
      [{ value: 1, name: 'Embedded', color: red, visible: true }],
      [4, 4, 4]
    );
    const scalars = output.getVtkImageData().getPointData().getScalars();
    scalars.getData()[42] = 7;
    scalars.modified();

    // Asserted, not discarded: the import pairs the masks it minted with the
    // descriptors it decoded by position, so a descriptor list that grows
    // after the decode fails the whole apply rather than the row below.
    expect(
      await importResult([
        { value: 1, name: 'Explicit', color: blue, visible: false },
        { value: 99, name: 'Absent', color: blue },
      ])
    ).toEqual({ status: 'applied' });

    // Value 99 has no voxels and no header block. It used to be dropped; the
    // maintainer's decision is that a segment a result DECLARES but leaves
    // EMPTY appears as an empty row, so it is minted after the decoded ones.
    expect(appearanceOnB()).toMatchObject([
      { name: 'Explicit', color: blue, visible: false },
      { name: 'output 7' },
      { name: 'Absent', color: blue, visible: true },
    ]);
    expect(registry().findSegmentByName('Embedded')?.color).toEqual(red);
    expect(
      store().imageMasks('parent-B')[1].representations.labelmap?.extent
    ).toEqual([2, 2, 2, 2, 2, 2]);
    expect(
      isEmptyExtent(
        store().imageMasks('parent-B')[2].representations.labelmap!.extent
      )
    ).toBe(true);
  });

  it('applies source-value descriptions independently to every component', async () => {
    const values = new Uint8Array(128);
    values[21 * 2] = 1;
    values[42 * 2 + 1] = 1;
    useImageCacheStore()
      .getVtkImageData('output')!
      .getPointData()
      .setScalars(vtkDataArray.newInstance({ numberOfComponents: 2, values }));

    await importResult([{ value: 1, name: 'Liver', color: blue }]);

    expect(appearanceOnB()).toMatchObject([
      { name: 'Liver', color: blue },
      { name: 'Liver (2)', color: blue },
    ]);
    expect(
      store()
        .imageMasks('parent-B')
        .map((mask) => mask.representations.labelmap?.extent)
    ).toEqual([
      [1, 1, 1, 1, 1, 1],
      [2, 2, 2, 2, 2, 2],
    ]);
  });
});
