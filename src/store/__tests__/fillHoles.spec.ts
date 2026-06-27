import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { useFillHolesStore } from '@/src/store/tools/fillHoles';
import { useImageCacheStore } from '@/src/store/image-cache';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { useViewStore } from '@/src/store/views';

const fillHolesWorkerMock = vi.hoisted(() => vi.fn(async (input) => input));

vi.mock('comlink', () => ({
  wrap: () => ({
    fillHolesWorker: fillHolesWorkerMock,
  }),
}));

vi.mock('@/src/store/image-stats', () => ({
  useImageStatsStore: () => ({ stats: {} }),
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
    const segmentGroupStore = useSegmentGroupStore();
    const viewStore = useViewStore();
    const viewSliceStore = useViewSliceStore();
    const paintStore = usePaintToolStore();
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

    const groupId = segmentGroupStore.addLabelmap(labelMap, {
      name: 'Test group',
      parentImage: parentImageID,
      segments: {
        order: [1],
        byValue: {
          1: {
            value: 1,
            name: 'Segment 1',
            color: [255, 0, 0, 255],
            visible: true,
            locked: false,
          },
        },
      },
    });

    const axialView = viewStore.visibleViews.find(
      (view) => view.type === '2D' && view.options.orientation === 'Axial'
    );
    expect(axialView).toBeDefined();
    viewStore.setDataForView(axialView!.id, parentImageID);
    viewStore.setActiveView(axialView!.id);
    viewSliceStore.updateConfig(axialView!.id, parentImageID, {
      slice: parentSlice,
    });

    paintStore.activeSegmentGroupID = groupId;
    paintStore.activeSegment = 1;

    return { fillHolesStore };
  }

  it('uses the label-map axis for the active parent view axis', async () => {
    // Label-map I points along parent/world axial, so an active Axial view must
    // be sent to the worker as axis 0 rather than the parent image's axis 2.
    const labelMap = makeLabelMap(
      [5, 10, 10],
      [1, 1, 1],
      [0, 0, 1, 0, 1, 0, 1, 0, 0]
    );
    const { fillHolesStore } = await setupFillHolesRun(labelMap, 0);

    await fillHolesStore.computeAlgorithm(labelMap, 1);

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
    const { fillHolesStore } = await setupFillHolesRun(labelMap, 4);

    await fillHolesStore.computeAlgorithm(labelMap, 1);

    expect(fillHolesWorkerMock).toHaveBeenCalledTimes(1);
    expect(fillHolesWorkerMock.mock.calls[0][0]).toMatchObject({
      axis: 2,
      sliceIndex: 2,
    });
  });
});
