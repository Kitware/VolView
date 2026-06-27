import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as Comlink from 'comlink';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { useViewStore } from '@/src/store/views';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { getImageMetadata } from '@/src/composables/useCurrentImage';
import { getEffectiveView } from '@/src/core/views/effectiveView';
import { fillHolesWorker } from '@/src/core/tools/paint/fillHoles.worker';
import { convertSliceIndex } from '@/src/utils/imageSpace';
import { getLPSDirections } from '@/src/utils/lps';

export enum FillHolesSliceScope {
  CurrentSlice = 'currentSlice',
  WholeVolume = 'wholeVolume',
}

export enum FillHolesSegmentScope {
  AllSegments = 'allSegments',
  SelectedSegment = 'selectedSegment',
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

export const useFillHolesStore = defineStore('fillHoles', () => {
  const sliceScope = ref(FillHolesSliceScope.CurrentSlice);
  const segmentScope = ref(FillHolesSegmentScope.AllSegments);

  function setSliceScope(value: FillHolesSliceScope) {
    sliceScope.value = value;
  }

  function setSegmentScope(value: FillHolesSegmentScope) {
    segmentScope.value = value;
  }

  async function computeAlgorithm(
    segImage: vtkLabelMap,
    activeSegment: number
  ) {
    const viewStore = useViewStore();
    const viewSliceStore = useViewSliceStore();
    const paintStore = usePaintToolStore();
    const segmentGroupStore = useSegmentGroupStore();

    // Fill Holes works on the slice plane of the 2D view the user is on, so a
    // 2D view must be active to know which axis (and slice) to operate on.
    const effectiveView = getEffectiveView(viewStore.activeView);
    if (effectiveView?.kind !== 'volume2D') {
      throw new Error(
        'Fill Holes needs an active 2D slice view. Click a 2D view, then try again.'
      );
    }

    const groupId = paintStore.activeSegmentGroupID;
    if (!groupId) {
      throw new Error('No active segment group');
    }
    const metadata = segmentGroupStore.metadataByID[groupId];

    const parentMetadata = getImageMetadata(metadata.parentImage);
    const labelMapLpsOrientation = getLPSDirections(segImage.getDirection());
    const axis = labelMapLpsOrientation[effectiveView.axis];

    const dimensions = segImage.getDimensions() as [number, number, number];
    const data = segImage.getPointData().getScalars().getData();

    let sliceIndex: number | undefined;
    if (sliceScope.value === FillHolesSliceScope.CurrentSlice) {
      const sliceConfig = viewSliceStore.getConfig(
        effectiveView.viewInfo.id,
        metadata.parentImage
      );
      const parentAxis = parentMetadata.lpsOrientation[effectiveView.axis];
      const parentSlice =
        sliceConfig?.slice ??
        Math.floor(parentMetadata.dimensions[parentAxis] / 2);
      sliceIndex = convertSliceIndex(
        parentSlice,
        parentMetadata.lpsOrientation,
        parentMetadata.indexToWorld,
        segImage,
        effectiveView.axis
      );
    }

    const selectedSegment =
      segmentScope.value === FillHolesSegmentScope.SelectedSegment;
    const label = selectedSegment ? activeSegment : undefined;
    // All-segments mode can fill a hole with any bordering label, so guard
    // locked segments from being grown. Selected-segment mode only writes the
    // active segment, whose lock is already enforced before the process starts.
    const lockedLabels = selectedSegment
      ? undefined
      : Object.values(metadata.segments.byValue)
          .filter((segment) => segment.locked)
          .map((segment) => segment.value);

    const worker = await getWorker();
    return worker.fillHolesWorker({
      data,
      dimensions,
      axis,
      sliceIndex,
      label,
      lockedLabels,
    });
  }

  return {
    sliceScope,
    segmentScope,
    setSliceScope,
    setSegmentScope,
    computeAlgorithm,
  };
});
