import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkLabelMap from '@/src/vtk/LabelMap';
import {
  FillHolesSegmentScope,
  useFillHolesStore,
} from '@/src/store/tools/fillHoles';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { useViewStore } from '@/src/store/views';

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

function makeLabelMap(
  dimensions: Vector3,
  spacing: Vector3,
  direction: Matrix3
) {
  const labelMap = vtkLabelMap.newInstance({ spacing, direction });
  labelMap.setDimensions(dimensions);
  addScalars(
    labelMap,
    new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2])
  );
  labelMap.computeTransforms();
  return labelMap;
}

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

  async function setupFillHolesRun(labelMap: vtkLabelMap, parentSlice: number) {
    const imageCacheStore = useImageCacheStore();
    const segmentationStore = useSegmentationStore();
    const viewStore = useViewStore();
    const viewSliceStore = useViewSliceStore();
    const fillHolesStore = useFillHolesStore();

    const parentImageID = 'parent-image';
    const parentImage = makeImage(
      [10, 10, 10],
      [1, 1, 1],
      [1, 0, 0, 0, 1, 0, 0, 0, 1]
    );
    imageCacheStore.addVTKImageData(parentImage, 'Parent', {
      id: parentImageID,
    });
    await nextTick();

    const artifactId = segmentationStore.registerArtifact(labelMap, {
      name: 'Test group',
      parentImage: parentImageID,
    });
    const [segment] = segmentationStore.setArtifactSegments(artifactId, [
      {
        value: 1,
        name: 'Segment 1',
        color: [255, 0, 0, 255],
        visible: true,
        locked: false,
      },
    ]);
    const segmentationId =
      segmentationStore.getSegmentationForImage(parentImageID)!.id;

    const axialView = viewStore.visibleViews.find(
      (view) => view.type === '2D' && view.options.orientation === 'Axial'
    );
    expect(axialView).toBeDefined();
    viewStore.setDataForView(axialView!.id, parentImageID);
    viewStore.setActiveView(axialView!.id);
    viewSliceStore.updateConfig(axialView!.id, parentImageID, {
      slice: parentSlice,
    });

    segmentationStore.setActiveSegment(segmentationId, segment.id);

    return {
      fillHolesStore,
      segmentationStore,
      artifactId,
      segmentationId,
      segmentId: segment.id,
    };
  }

  /** Fill Holes defaults to every segment, so its target carries no segment. */
  const artifactTarget = (artifactId: string) => ({
    scope: 'artifact' as const,
    artifactId,
    voxels: useSegmentationStore().artifactVoxels(artifactId),
  });

  const segmentTarget = (
    artifactId: string,
    segmentationId: string,
    segmentId: string,
    labelValue: number
  ) => ({
    scope: 'segment' as const,
    artifactId,
    labelValue,
    voxels: useSegmentationStore().segmentVoxels(segmentationId, segmentId),
  });

  it('uses the label-map axis for the active parent view axis', async () => {
    // Label-map I points along parent/world axial, so an active Axial view must
    // be sent to the worker as axis 0 rather than the parent image's axis 2.
    const labelMap = makeLabelMap(
      [5, 10, 10],
      [1, 1, 1],
      [0, 0, 1, 0, 1, 0, 1, 0, 0]
    );
    const { fillHolesStore, artifactId } = await setupFillHolesRun(labelMap, 0);

    await fillHolesStore.computeAlgorithm(artifactTarget(artifactId));

    expect(fillHolesWorkerMock).toHaveBeenCalledTimes(1);
    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({
      axis: 0,
    });
  });

  it('converts the active parent slice into label-map slice space', async () => {
    // Same orientation, different axial spacing: parent slice 4 is world z=4,
    // which lands on label-map slice 2 when label-map z spacing is 2.
    const labelMap = makeLabelMap(
      [10, 10, 5],
      [1, 1, 2],
      [1, 0, 0, 0, 1, 0, 0, 0, 1]
    );
    const { fillHolesStore, artifactId } = await setupFillHolesRun(labelMap, 4);

    await fillHolesStore.computeAlgorithm(artifactTarget(artifactId));

    expect(fillHolesWorkerMock).toHaveBeenCalledTimes(1);
    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({
      axis: 2,
      sliceIndex: 2,
    });
  });

  it('guards the locked segments of the active target’s artifact', async () => {
    const labelMap = makeLabelMap(
      [10, 10, 10],
      [1, 1, 1],
      [1, 0, 0, 0, 1, 0, 0, 0, 1]
    );
    const { fillHolesStore, segmentationStore, segmentationId, artifactId } =
      await setupFillHolesRun(labelMap, 0);
    const locked = segmentationStore.createSegment(segmentationId, {
      name: 'Locked',
    });
    segmentationStore.ensureLabelmapBinding(segmentationId, locked.id);
    segmentationStore.updateSegment(segmentationId, locked.id, {
      locked: true,
    });
    const lockedValue = segmentationStore.resolveLabelmapBinding(
      segmentationId,
      locked.id
    )!.labelValue;

    await fillHolesStore.computeAlgorithm(artifactTarget(artifactId));

    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({
      lockedLabels: [lockedValue],
    });
  });

  it('sends the artifact’s live voxels rather than a copy of them', async () => {
    const labelMap = makeLabelMap(
      [10, 10, 10],
      [1, 1, 1],
      [1, 0, 0, 0, 1, 0, 0, 0, 1]
    );
    const { fillHolesStore, artifactId } = await setupFillHolesRun(labelMap, 0);

    await fillHolesStore.computeAlgorithm(artifactTarget(artifactId));

    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({
      dimensions: [10, 10, 10],
    });
    expect(fillHolesWorkerMock.mock.calls[0][0].data).toBe(
      labelMap.getPointData().getScalars().getData()
    );
  });

  it('fills only the selected segment when scoped to one', async () => {
    const labelMap = makeLabelMap(
      [10, 10, 10],
      [1, 1, 1],
      [1, 0, 0, 0, 1, 0, 0, 0, 1]
    );
    const { fillHolesStore, artifactId, segmentationId, segmentId } =
      await setupFillHolesRun(labelMap, 0);
    fillHolesStore.setSegmentScope(FillHolesSegmentScope.SelectedSegment);

    await fillHolesStore.computeAlgorithm(
      segmentTarget(artifactId, segmentationId, segmentId, 1)
    );

    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({ label: 1 });
    expect(fillHolesWorkerMock.mock.calls[0][0].lockedLabels).toBeUndefined();
  });

  it('refuses a selected-segment fill against an artifact-scoped target', async () => {
    const labelMap = makeLabelMap(
      [10, 10, 10],
      [1, 1, 1],
      [1, 0, 0, 0, 1, 0, 0, 0, 1]
    );
    const { fillHolesStore, artifactId } = await setupFillHolesRun(labelMap, 0);
    fillHolesStore.setSegmentScope(FillHolesSegmentScope.SelectedSegment);

    // Silently filling every segment is the failure the union rules out.
    await expect(
      fillHolesStore.computeAlgorithm(artifactTarget(artifactId))
    ).rejects.toThrow(/active segment/i);
    expect(fillHolesWorkerMock).not.toHaveBeenCalled();
  });
});
