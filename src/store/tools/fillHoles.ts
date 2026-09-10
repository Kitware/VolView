import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as Comlink from 'comlink';
import { useViewStore } from '@/src/store/views';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import type { ProcessTarget } from '@/src/store/tools/paintProcess';
import { getImageMetadata } from '@/src/composables/useCurrentImage';
import { getEffectiveView } from '@/src/core/views/effectiveView';
import { fillHolesWorker } from '@/src/core/tools/paint/fillHoles.worker';
import { convertSliceIndex } from '@/src/utils/imageSpace';
import { getLPSDirections } from '@/src/utils/lps';
import type { LPSAxis } from '@/src/types/lps';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

export enum FillHolesSliceScope {
  CurrentSlice = 'currentSlice',
  WholeVolume = 'wholeVolume',
}

export enum FillHolesSegmentScope {
  AllSegments = 'allSegments',
  SelectedSegment = 'selectedSegmentOn',
}

type WorkerApi = {
  fillHolesWorker: typeof fillHolesWorker;
};

let workerInstance: Comlink.Remote<WorkerApi> | null = null;

async function getWorker() {
  if (!workerInstance) {
    const worker = new Worker(
      new URL('@/src/core/tools/paint/fillHoles.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerInstance = Comlink.wrap<WorkerApi>(worker);
  }
  return workerInstance;
}

/**
 * The current parent slice in the mask's own index space, or undefined when the
 * mask does not reach it. A segment's mask is cropped to its own extent, so a
 * slice outside it converts to an index the worker would fold back onto a real
 * slice of the mask and fill the wrong one.
 */
function maskSliceIndex(
  view: { viewInfo: { id: string }; axis: LPSAxis },
  parentImageId: string,
  segImage: vtkImageData,
  sliceCount: number
) {
  const parentMetadata = getImageMetadata(parentImageId);
  const sliceConfig = useViewSliceStore().getConfig(
    view.viewInfo.id,
    parentImageId
  );
  const parentSlice = sliceConfig.slice;
  const sliceIndex = convertSliceIndex(
    parentSlice,
    parentMetadata.lpsOrientation,
    parentMetadata.indexToWorld,
    segImage,
    view.axis
  );
  return sliceIndex < 0 || sliceIndex >= sliceCount ? undefined : sliceIndex;
}

export const useFillHolesStore = defineStore('fillHoles', () => {
  const sliceScope = ref(FillHolesSliceScope.CurrentSlice);
  const segmentScope = ref(FillHolesSegmentScope.AllSegments);

  function setSliceScope(value: FillHolesSliceScope) {
    sliceScope.value = value;
  }

  function setSegmentScope(value: FillHolesSegmentScope) {
    segmentScope.value = value;
  }

  async function computeAlgorithm(target: ProcessTarget) {
    const viewStore = useViewStore();

    // Fill Holes works on the slice plane of the 2D view the user is on, so a
    // 2D view must be active to know which axis (and slice) to operate on.
    const effectiveView = getEffectiveView(viewStore.activeView);
    if (effectiveView?.kind !== 'volume2D') {
      throw new Error(
        'Fill Holes needs an active 2D slice view. Click a 2D view, then try again.'
      );
    }

    const { parentImageId, voxels } = target;
    const segImage = voxels.image();

    const labelMapLpsOrientation = getLPSDirections(segImage.getDirection());
    const axis = labelMapLpsOrientation[effectiveView.axis];

    const dimensions = segImage.getDimensions() as [number, number, number];
    // The worker structured-clones its input, so the live buffer is right here.
    const data = voxels.scalars();

    const currentSlice = sliceScope.value === FillHolesSliceScope.CurrentSlice;
    const sliceIndex = currentSlice
      ? maskSliceIndex(effectiveView, parentImageId, segImage, dimensions[axis])
      : undefined;
    if (currentSlice && sliceIndex === undefined) {
      // The user named one segment, so say the slice misses it. An
      // all-segments pass simply has nothing to do in this one.
      if (segmentScope.value === FillHolesSegmentScope.SelectedSegment) {
        throw new Error(
          'the selected segment has nothing on this slice. Scroll to a slice it covers, then try again.'
        );
      }
      return undefined;
    }

    const worker = await getWorker();
    const scalars = await worker.fillHolesWorker({
      data,
      dimensions,
      axis,
      sliceIndex,
      label: target.labelValue,
    });
    return { scalars, extent: target.maskExtent };
  }

  return {
    sliceScope,
    segmentScope,
    setSliceScope,
    setSegmentScope,
    computeAlgorithm,
  };
});
