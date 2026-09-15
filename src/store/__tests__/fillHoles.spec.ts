import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import {
  FillHolesSegmentScope,
  FillHolesSliceScope,
  useFillHolesStore,
} from '@/src/store/tools/fillHoles';
import { PROCESS_DEFINITIONS } from '@/src/components/processes';
import {
  ProcessType,
  usePaintProcessStore,
} from '@/src/store/tools/paintProcess';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import {
  selectSegment,
  mintSegment,
} from '@/src/store/__tests__/segmentMaskFixtures';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { useViewStore } from '@/src/store/views';
import type { Extent3D } from '@/src/types/segmentation';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { SEGMENT_VALUE } from '@/src/store/segmentLabelValue';

const fillHolesWorkerMock = vi.hoisted(() => vi.fn(async (input) => input));

// eslint-disable-next-line no-restricted-syntax -- the fill-holes worker has no counterpart in the node test environment
vi.mock('comlink', () => {
  const releaseProxy = Symbol('releaseProxy');
  return {
    releaseProxy,
    wrap: () => ({
      fillHolesWorker: fillHolesWorkerMock,
      histogram: async () => new Array(256).fill(0),
      [releaseProxy]: () => {},
    }),
  };
});

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
    const pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
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
    const segment = segmentationStore.createMask(
      segmentation.id,
      mintSegment({
        name: 'Segment 1',
      })
    );
    const voxels = segmentationStore.maskVoxels(segment.id);
    voxels.materialize();
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

    selectSegment(segment.id);

    return {
      fillHolesStore,
      segmentationStore,
      parentImageID,
      segmentationId: segmentation.id,
      maskId: segment.id,
      labelMap: voxels.image(),
    };
  }

  /** Every fill is one segment's own bounded mask, in either segment scope. */
  const segmentTarget = (
    parentImageId: string,
    maskId: string,
    labelValue: number
  ) => {
    const voxels = useSegmentationStore().maskVoxels(maskId);
    return {
      parentImageId,
      parentDimensions: [
        ...useImageCacheStore().getVtkImageData(parentImageId)!.getDimensions(),
      ] as [number, number, number],
      maskId,
      labelValue,
      scalars: voxels.snapshot(),
      dimensions: [...voxels.image().getDimensions()] as [
        number,
        number,
        number,
      ],
      spacing: [...voxels.image().getSpacing()] as [number, number, number],
      direction: Array.from(voxels.image().getDirection()),
      parentOrigin: Array.from(
        useImageCacheStore().getVtkImageData(parentImageId)!.getOrigin()
      ),
      maskExtent: [...voxels.binding()!.extent] as Extent3D,
    };
  };

  it('uses the mask axis the active parent view maps to', async () => {
    // Index I points along world axial here, so an active Axial view must be
    // sent to the worker as axis 0 rather than as index axis 2.
    const { fillHolesStore, parentImageID, maskId } = await setupFillHolesRun(
      {
        dimensions: [5, 10, 10],
        spacing: UNIT,
        direction: [0, 0, 1, 0, 1, 0, 1, 0, 0],
      },
      [0, 4, 0, 9, 0, 9],
      0
    );

    await fillHolesStore.computeAlgorithm(
      segmentTarget(parentImageID, maskId, 1)
    );

    expect(fillHolesWorkerMock).toHaveBeenCalledTimes(1);
    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({
      axis: 0,
    });
  });

  it('converts the active parent slice into mask slice space', async () => {
    // A segment-scoped fill writes the bounded mask, which starts two slices
    // into the parent, so parent slice 4 is mask slice 2.
    const { fillHolesStore, parentImageID, maskId } = await setupFillHolesRun(
      { dimensions: [10, 10, 5], spacing: [1, 1, 2], direction: IDENTITY },
      [0, 9, 0, 9, 2, 4],
      4
    );
    fillHolesStore.setSegmentScope(FillHolesSegmentScope.SelectedSegment);

    await fillHolesStore.computeAlgorithm(
      segmentTarget(parentImageID, maskId, 1)
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
      const { fillHolesStore, parentImageID, maskId } = await setupFillHolesRun(
        { dimensions: [10, 10, 5], spacing: [1, 1, 2], direction: IDENTITY },
        extent,
        parentSlice
      );
      fillHolesStore.setSegmentScope(FillHolesSegmentScope.SelectedSegment);

      await expect(
        fillHolesStore.computeAlgorithm(segmentTarget(parentImageID, maskId, 1))
      ).rejects.toThrow(/nothing on this slice/i);
      expect(fillHolesWorkerMock).not.toHaveBeenCalled();
    }
  );

  it('converts nothing for a mask that spans the parent', async () => {
    const { fillHolesStore, parentImageID, maskId } = await setupFillHolesRun(
      { dimensions: [10, 10, 5], spacing: [1, 1, 2], direction: IDENTITY },
      [0, 9, 0, 9, 0, 4],
      4
    );

    await fillHolesStore.computeAlgorithm(
      segmentTarget(parentImageID, maskId, 1)
    );

    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({
      axis: 2,
      sliceIndex: 4,
      dimensions: [10, 10, 5],
    });
  });

  it('leaves an all-segments fill alone on a slice its mask misses', async () => {
    // One segment of several missing the slice must not fail the whole pass,
    // and it hands back no result at all: a mask with nothing to fill is not
    // copied out, written back, or handed to the renderer as changed.
    const { fillHolesStore, parentImageID, maskId } = await setupFillHolesRun(
      { dimensions: [10, 10, 5], spacing: [1, 1, 2], direction: IDENTITY },
      [0, 9, 0, 9, 2, 4],
      0
    );
    const voxels = useSegmentationStore().maskVoxels(maskId);
    voxels.scalars()[0] = 1;
    const held = Array.from(voxels.scalars());

    const out = await fillHolesStore.computeAlgorithm(
      segmentTarget(parentImageID, maskId, 1)
    );

    expect(fillHolesWorkerMock).not.toHaveBeenCalled();
    expect(out).toBeUndefined();
    expect(Array.from(voxels.scalars())).toEqual(held);
  });

  it('sends the target’s own buffer rather than a copy of it', async () => {
    const { fillHolesStore, parentImageID, maskId } = await setupFillHolesRun(
      { dimensions: [10, 10, 10], spacing: UNIT, direction: IDENTITY },
      [0, 9, 0, 9, 0, 9],
      0
    );
    const target = segmentTarget(parentImageID, maskId, 1);

    await fillHolesStore.computeAlgorithm(target);

    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({
      dimensions: [10, 10, 10],
    });
    expect(fillHolesWorkerMock.mock.calls[0][0].data).toBe(target.scalars);
  });

  it('fills only the selected segment when scoped to one', async () => {
    const { fillHolesStore, parentImageID, maskId } = await setupFillHolesRun(
      { dimensions: [10, 10, 10], spacing: UNIT, direction: IDENTITY },
      [0, 9, 0, 9, 0, 9],
      0
    );
    fillHolesStore.setSegmentScope(FillHolesSegmentScope.SelectedSegment);

    await fillHolesStore.computeAlgorithm(
      segmentTarget(parentImageID, maskId, 1)
    );

    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({ label: 1 });
  });

  it('wires the segment scope into process target selection', async () => {
    const { fillHolesStore, segmentationStore, parentImageID, maskId } =
      await setupFillHolesRun(
        { dimensions: [7, 3, 1], spacing: UNIT, direction: IDENTITY },
        [0, 2, 0, 2, 0, 0],
        0
      );
    const first = segmentationStore.maskVoxels(maskId);
    first.apply(new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]));
    const segmentation =
      segmentationStore.getSegmentationForImage(parentImageID)!;
    const other = segmentationStore.createMask(
      segmentation.id,
      mintSegment({
        name: 'Other',
      })
    );
    const second = segmentationStore.maskVoxels(other.id);
    second.materialize();
    const otherValue = SEGMENT_VALUE;
    second.ensureContains([4, 6, 0, 2, 0, 0]);
    second.apply(
      new Uint8Array([
        otherValue,
        otherValue,
        otherValue,
        otherValue,
        0,
        otherValue,
        otherValue,
        otherValue,
        otherValue,
      ])
    );
    fillHolesStore.setSliceScope(FillHolesSliceScope.WholeVolume);
    fillHolesWorkerMock.mockImplementation(async ({ data, label }) => {
      const filled = new Uint8Array(data);
      filled[4] = label;
      return filled;
    });
    const definition = PROCESS_DEFINITIONS.find(
      ({ type }) => type === ProcessType.FillHoles
    )!;
    const run = () =>
      usePaintProcessStore().startProcess(definition.getAlgorithm(), {
        requiresActiveSegment: definition.requiresActiveSegment?.() ?? true,
      });

    fillHolesStore.setSegmentScope(FillHolesSegmentScope.SelectedSegment);
    await run();

    expect(first.scalars()[4]).toBe(1);
    expect(second.scalars()[4]).toBe(0);
    usePaintProcessStore().cancelProcess();

    fillHolesStore.setSegmentScope(FillHolesSegmentScope.AllSegments);
    await run();

    expect(first.scalars()[4]).toBe(1);
    expect(second.scalars()[4]).toBe(otherValue);
  });
});
