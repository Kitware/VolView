import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import type { SegmentDescriptor } from '@/backend-contract';
import {
  applyIntent,
  appApplyDependencies,
  type ApplyDependencies,
} from '@/src/processing/applyResults';
import { buildSegNrrdMetadata } from '@/src/io/segNrrdMetadata';
import { ensureSameSpace } from '@/src/io/resample/resample';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentStore } from '@/src/segmentation/segments';
import { usePolygonStore } from '@/src/store/tools/polygons';
import {
  seatImage,
  seedVoxel,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

import { savedMasks, serializeScene } from './serializedScene';

const registry = () => useSegmentStore().segments;
const source = { providerId: 'provider', jobId: 'job', outputId: 'mask' };
const blue = [0, 0, 255, 255] as [number, number, number, number];
const red = [255, 0, 0, 255] as [number, number, number, number];

const existingMask = (imageId: string, name: string) => {
  const segmentId = registry().mintSegment({ name, color: red });
  const maskId = store().resolveEditTarget(imageId, segmentId);
  seedVoxel(maskId, [1, 1, 1]);
  return { segmentId, maskId };
};

const importResult = (
  segments?: SegmentDescriptor[],
  overrides: Partial<ApplyDependencies> = {}
) =>
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
      ...overrides,
    }
  );

const save = () => serializeScene(['parent-A', 'parent-B']);

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  setActivePinia(createPinia());
  await seatImage('parent-A');
  await seatImage('parent-B');
  const values = new Uint8Array(64);
  values[21] = 1;
  await seatImage('output', { name: 'output.nrrd', values });
});

describe('processing segment identity', () => {
  it("does not change another image's segment named after the output file", async () => {
    const { segmentId, maskId } = existingMask('parent-A', 'output');
    const toolId = usePolygonStore().addTool({
      imageID: 'parent-A',
      segmentId,
    });
    const before = await save();

    expect(
      await importResult([{ value: 1, name: 'Liver', color: blue }])
    ).toEqual({ status: 'applied' });

    const after = await save();
    expect(savedMasks(after, 'parent-A')).toEqual(
      savedMasks(before, 'parent-A')
    );
    expect(after.manifest.tools?.polygons?.tools).toMatchObject([
      { id: toolId, segmentId },
    ]);
    expect(savedMasks(after, 'parent-A')[0]).toMatchObject({
      id: maskId,
      segmentId,
    });
    expect(savedMasks(after, 'parent-B')).toMatchObject([
      {
        segment: { name: 'Liver', color: blue },
        extent: [1, 1, 1, 1, 1, 1],
        source,
        artifact: { dimensions: [1, 1, 1], values: [1] },
      },
    ]);
  });

  it('reuses the declared segment across images and keeps its existing appearance', async () => {
    const { segmentId } = existingMask('parent-A', 'Tumor');
    registry().updateSegment(segmentId, { visible: false, locked: true });

    await importResult([
      { value: 1, name: 'Tumor', color: blue, visible: true },
    ]);

    const saved = await save();
    expect(savedMasks(saved, 'parent-B')).toMatchObject([
      {
        segmentId,
        segment: { name: 'Tumor', color: red, visible: false, locked: true },
      },
    ]);
    expect(saved.manifest.segments).toHaveLength(1);
  });

  it('uses a distinct segment when the declared segment already has a mask on the target', async () => {
    const { segmentId, maskId } = existingMask('parent-B', 'Tumor');

    await importResult([{ value: 1, name: 'Tumor', color: blue }]);

    const saved = await save();
    expect(savedMasks(saved, 'parent-B')).toMatchObject([
      { id: maskId, segmentId, segment: { name: 'Tumor', color: red } },
      { segment: { name: 'Tumor (2)', color: blue } },
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

    expect(
      await importResult([
        { value: 1, name: 'Explicit', color: blue, visible: false },
        { value: 99, name: 'Absent', color: blue },
      ])
    ).toEqual({ status: 'applied' });

    const saved = await save();
    expect(savedMasks(saved, 'parent-B')).toMatchObject([
      {
        segment: { name: 'Explicit', color: blue, visible: false },
        artifact: { values: [1] },
      },
      {
        segment: { name: 'output 7' },
        extent: [2, 2, 2, 2, 2, 2],
        artifact: { values: [1] },
      },
      {
        segment: { name: 'Absent', color: blue, visible: true },
        extent: [0, -1, 0, -1, 0, -1],
        artifact: { values: [0] },
      },
    ]);
    expect(
      saved.manifest.segments?.find(({ name }) => name === 'Embedded')?.color
    ).toEqual(red);
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

    expect(savedMasks(await save(), 'parent-B')).toMatchObject([
      {
        segment: { name: 'Liver', color: blue },
        extent: [1, 1, 1, 1, 1, 1],
        artifact: { values: [1] },
      },
      {
        segment: { name: 'Liver (2)', color: blue },
        extent: [2, 2, 2, 2, 2, 2],
        artifact: { values: [1] },
      },
    ]);
  });

  it('imports every component again when a retry follows a partial import', async () => {
    const resample = vi
      .fn(ensureSameSpace)
      .mockImplementationOnce(ensureSameSpace)
      .mockRejectedValueOnce(new Error('Resample failed'));
    const segmentWriter = {
      ...appApplyDependencies().segmentWriter,
      convertImageToLabelmap: (
        ...args: Parameters<ReturnType<typeof store>['convertImageToLabelmap']>
      ) =>
        store().convertImageToLabelmap(args[0], args[1], {
          ...args[2],
          resample,
        }),
    };
    let imports = 0;
    const importTwoComponents = async () => {
      imports += 1;
      const id = `layered-${imports}`;
      const values = new Uint8Array(128);
      values[21 * 2] = 1;
      values[42 * 2 + 1] = 1;
      const image = await seatImage(id, { name: 'output.nrrd' });
      image
        .getPointData()
        .setScalars(
          vtkDataArray.newInstance({ numberOfComponents: 2, values })
        );
      return id;
    };

    expect(
      await importResult(undefined, {
        importVolume: importTwoComponents,
        segmentWriter,
      })
    ).toMatchObject({ status: 'failed' });
    expect(savedMasks(await save(), 'parent-B')).toMatchObject([
      {
        extent: [1, 1, 1, 1, 1, 1],
        source: undefined,
        artifact: { values: [1] },
      },
    ]);
    expect(
      await importResult(undefined, {
        importVolume: importTwoComponents,
        segmentWriter,
      })
    ).toEqual({ status: 'applied' });
    expect(imports).toBe(2);
    expect(savedMasks(await save(), 'parent-B')).toMatchObject([
      {
        extent: [1, 1, 1, 1, 1, 1],
        source: undefined,
        artifact: { values: [1] },
      },
      { extent: [1, 1, 1, 1, 1, 1], source, artifact: { values: [1] } },
      { extent: [2, 2, 2, 2, 2, 2], source, artifact: { values: [1] } },
    ]);
  });
});
