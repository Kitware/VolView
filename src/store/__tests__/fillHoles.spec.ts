import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import {
  FillHolesSegmentScope,
  useFillHolesStore,
} from '@/src/store/tools/fillHoles';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { useViewStore } from '@/src/store/views';
import type { Extent3D } from '@/src/types/segmentation';

const fillHolesWorkerMock = vi.hoisted(() => vi.fn(async (input) => input));

// eslint-disable-next-line no-restricted-syntax -- the fill-holes worker has no counterpart in the node test environment
vi.mock('comlink', () => ({
  wrap: () => ({
    fillHolesWorker: fillHolesWorkerMock,
  }),
}));

function addScalars(image: vtkImageData, values: Uint8Array) {
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values,
    })
  );
}

type Vector3 = [number, number, number];
type Matrix3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function makeImage(dimensions: Vector3, spacing: Vector3, direction: Matrix3) {
  const image = vtkImageData.newInstance({ spacing, direction });
  image.setDimensions(dimensions);
  addScalars(
    image,
    new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2])
  );
  image.computeTransforms();
  return image;
}

const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const UNIT: Vector3 = [1, 1, 1];

describe('Fill Holes store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fillHolesWorkerMock.mockClear();
    vi.stubGlobal(
      'Worker',
      class {
        terminate() {}
      }
    );
  });

  /**
   * A parent image with one segment whose mask covers `extent`. Masks sit on
   * the parent's grid, so the parent's geometry is the mask's geometry and the
   * extent is what puts the mask somewhere in it.
   */
  async function setupFillHolesRun(
    parent: { dimensions: Vector3; spacing: Vector3; direction: Matrix3 },
    extent: Extent3D,
    parentSlice: number
  ) {
    const imageCacheStore = useImageCacheStore();
    const segmentationStore = useSegmentationStore();
    const viewStore = useViewStore();
    const viewSliceStore = useViewSliceStore();
    const fillHolesStore = useFillHolesStore();

    const parentImageID = 'parent-image';
    imageCacheStore.addVTKImageData(
      makeImage(parent.dimensions, parent.spacing, parent.direction),
      'Parent',
      { id: parentImageID }
    );
    await nextTick();

    const segmentation =
      segmentationStore.ensureSegmentationForImage(parentImageID);
    const segment = segmentationStore.createSegment(segmentation.id, {
      name: 'Segment 1',
    });
    const voxels = segmentationStore.segmentVoxels(segment.id);
    const { artifactId } = voxels.materialize();
    voxels.ensureContains(extent);

    const axialView = viewStore.visibleViews.find(
      (view) => view.type === '2D' && view.options.orientation === 'Axial'
    );
    expect(axialView).toBeDefined();
    viewStore.setDataForView(axialView!.id, parentImageID);
    viewStore.setActiveView(axialView!.id);
    viewSliceStore.updateConfig(axialView!.id, parentImageID, {
      slice: parentSlice,
    });

    segmentationStore.setActiveSegment(segment.id);

    return {
      fillHolesStore,
      segmentationStore,
      parentImageID,
      artifactId,
      segmentationId: segmentation.id,
      segmentId: segment.id,
      labelMap: voxels.image(),
    };
  }

  /** Another segment of the same image, with one voxel of its own. */
  function addSegmentWithVoxel(
    segmentationId: string,
    name: string,
    index: [number, number, number]
  ) {
    const segmentationStore = useSegmentationStore();
    const segment = segmentationStore.createSegment(segmentationId, { name });
    const voxels = segmentationStore.segmentVoxels(segment.id);
    const binding = voxels.materialize();
    voxels.ensureContains([
      index[0],
      index[0],
      index[1],
      index[1],
      index[2],
      index[2],
    ]);
    voxels.scalars()[0] = binding.labelValue;
    return { segmentId: segment.id, labelValue: binding.labelValue };
  }

  /** Fill Holes defaults to every segment, so its target is the whole image. */
  const imageTarget = (parentImageId: string) => ({
    scope: 'image' as const,
    parentImageId,
    voxels: useSegmentationStore().imageVoxels(parentImageId),
  });

  const segmentTarget = (
    parentImageId: string,
    artifactId: string,
    segmentId: string,
    labelValue: number
  ) => ({
    scope: 'segment' as const,
    parentImageId,
    artifactId,
    labelValue,
    voxels: useSegmentationStore().segmentVoxels(segmentId),
  });

  it('uses the mask axis the active parent view maps to', async () => {
    // Index I points along world axial here, so an active Axial view must be
    // sent to the worker as axis 0 rather than as index axis 2.
    const { fillHolesStore, parentImageID } = await setupFillHolesRun(
      {
        dimensions: [5, 10, 10],
        spacing: UNIT,
        direction: [0, 0, 1, 0, 1, 0, 1, 0, 0],
      },
      [0, 4, 0, 9, 0, 9],
      0
    );

    await fillHolesStore.computeAlgorithm(imageTarget(parentImageID));

    expect(fillHolesWorkerMock).toHaveBeenCalledTimes(1);
    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({
      axis: 0,
    });
  });

  it('converts the active parent slice into mask slice space', async () => {
    // A segment-scoped fill writes the bounded mask, which starts two slices
    // into the parent, so parent slice 4 is mask slice 2.
    const { fillHolesStore, parentImageID, artifactId, segmentId } =
      await setupFillHolesRun(
        { dimensions: [10, 10, 5], spacing: [1, 1, 2], direction: IDENTITY },
        [0, 9, 0, 9, 2, 4],
        4
      );
    fillHolesStore.setSegmentScope(FillHolesSegmentScope.SelectedSegment);

    await fillHolesStore.computeAlgorithm(
      segmentTarget(parentImageID, artifactId, segmentId, 1)
    );

    expect(fillHolesWorkerMock).toHaveBeenCalledTimes(1);
    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({
      axis: 2,
      sliceIndex: 2,
    });
  });

  it.each([
    ['below', [0, 9, 0, 9, 2, 4] as Extent3D, 0],
    ['above', [0, 9, 0, 9, 0, 1] as Extent3D, 4],
  ])(
    'refuses a selected-segment fill on a slice %s the segment',
    async (_where, extent, parentSlice) => {
      // Unclamped, the converted index folds back onto a real slice of the
      // cropped mask and the fill lands on a slice the user never picked.
      const { fillHolesStore, parentImageID, artifactId, segmentId } =
        await setupFillHolesRun(
          { dimensions: [10, 10, 5], spacing: [1, 1, 2], direction: IDENTITY },
          extent,
          parentSlice
        );
      fillHolesStore.setSegmentScope(FillHolesSegmentScope.SelectedSegment);

      await expect(
        fillHolesStore.computeAlgorithm(
          segmentTarget(parentImageID, artifactId, segmentId, 1)
        )
      ).rejects.toThrow(/nothing on this slice/i);
      expect(fillHolesWorkerMock).not.toHaveBeenCalled();
    }
  );

  it('fills the whole parent slice when scoped to every segment', async () => {
    // The composite spans the parent, so there is no mask offset to convert.
    const { fillHolesStore, parentImageID } = await setupFillHolesRun(
      { dimensions: [10, 10, 5], spacing: [1, 1, 2], direction: IDENTITY },
      [0, 9, 0, 9, 2, 4],
      4
    );

    await fillHolesStore.computeAlgorithm(imageTarget(parentImageID));

    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({
      axis: 2,
      sliceIndex: 4,
      dimensions: [10, 10, 5],
    });
  });

  it('guards the locked segments of the whole image', async () => {
    const {
      fillHolesStore,
      segmentationStore,
      parentImageID,
      segmentationId,
      segmentId,
    } = await setupFillHolesRun(
      { dimensions: [10, 10, 10], spacing: UNIT, direction: IDENTITY },
      [0, 9, 0, 9, 0, 9],
      0
    );
    segmentationStore.updateSegment(segmentId, { locked: true });
    const lockedValue =
      segmentationStore.resolveLabelmapBinding(segmentId)!.labelValue;
    // A second, unlocked segment: only the locked one is guarded, and a
    // segment outside the active one's mask is still reached.
    addSegmentWithVoxel(segmentationId, 'Other', [1, 1, 1]);

    await fillHolesStore.computeAlgorithm(imageTarget(parentImageID));

    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({
      lockedLabels: [lockedValue],
    });
  });

  it('sends every segment of the image, not just the active one', async () => {
    const { fillHolesStore, parentImageID, segmentationId, segmentId } =
      await setupFillHolesRun(
        { dimensions: [10, 10, 10], spacing: UNIT, direction: IDENTITY },
        [0, 9, 0, 9, 0, 9],
        0
      );
    const segmentationStore = useSegmentationStore();
    const activeVoxels = segmentationStore.segmentVoxels(segmentId);
    const activeValue = activeVoxels.binding()!.labelValue;
    activeVoxels.scalars()[0] = activeValue;
    const other = addSegmentWithVoxel(segmentationId, 'Other', [5, 5, 5]);

    await fillHolesStore.computeAlgorithm(imageTarget(parentImageID));

    const sent = new Set(fillHolesWorkerMock.mock.calls[0][0].data);
    expect(sent).toContain(activeValue);
    expect(sent).toContain(other.labelValue);
  });

  it('sends the target’s own buffer rather than a copy of it', async () => {
    const { fillHolesStore, parentImageID } = await setupFillHolesRun(
      { dimensions: [10, 10, 10], spacing: UNIT, direction: IDENTITY },
      [0, 9, 0, 9, 0, 9],
      0
    );
    const target = imageTarget(parentImageID);

    await fillHolesStore.computeAlgorithm(target);

    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({
      dimensions: [10, 10, 10],
    });
    expect(fillHolesWorkerMock.mock.calls[0][0].data).toBe(
      target.voxels.scalars()
    );
  });

  it('fills only the selected segment when scoped to one', async () => {
    const { fillHolesStore, parentImageID, artifactId, segmentId } =
      await setupFillHolesRun(
        { dimensions: [10, 10, 10], spacing: UNIT, direction: IDENTITY },
        [0, 9, 0, 9, 0, 9],
        0
      );
    fillHolesStore.setSegmentScope(FillHolesSegmentScope.SelectedSegment);

    await fillHolesStore.computeAlgorithm(
      segmentTarget(parentImageID, artifactId, segmentId, 1)
    );

    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({ label: 1 });
    expect(fillHolesWorkerMock.mock.calls[0][0].lockedLabels).toBeUndefined();
  });

  it('refuses a selected-segment fill against an image-scoped target', async () => {
    const { fillHolesStore, parentImageID } = await setupFillHolesRun(
      { dimensions: [10, 10, 10], spacing: UNIT, direction: IDENTITY },
      [0, 9, 0, 9, 0, 9],
      0
    );
    fillHolesStore.setSegmentScope(FillHolesSegmentScope.SelectedSegment);

    // Silently filling every segment is the failure the union rules out.
    await expect(
      fillHolesStore.computeAlgorithm(imageTarget(parentImageID))
    ).rejects.toThrow(/active segment/i);
    expect(fillHolesWorkerMock).not.toHaveBeenCalled();
  });
});
