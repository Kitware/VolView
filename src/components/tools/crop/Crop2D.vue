<script lang="ts">
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useCurrentSlice } from '@/src/composables/useCurrentSlice';
import { useVTKMultiWorldToSVG } from '@/src/composables/useVTKWorldToDisplay';
import { ImageMetadata } from '@/src/store/datasets-images';
import { useCropStore } from '@/src/store/tools/crop';
import { useViewStore } from '@/src/store/views';
import { LPSAxis, LPSBounds, LPSPoint } from '@/src/types/lps';
import { createLPSBounds, createLPSPoint, LPSAxes } from '@/src/utils/lps';
import { intersectMouseEventWithPlane } from '@/src/utils/vtk-helpers';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import { Vector2, Vector3 } from '@kitware/vtk.js/types';
import {
  computed,
  ComputedRef,
  DeepReadonly,
  defineComponent,
  ref,
  Ref,
  toRefs,
} from '@vue/composition-api';
import { vec3 } from 'gl-matrix';
import Crop2DLineHandle from './Crop2DLineHandle.vue';
import { CropLines } from './types';

function computeCropLines(
  viewID: Ref<string | null>,
  cropAxis: Ref<LPSAxis | null>,
  cropPlanes: DeepReadonly<Ref<Record<LPSAxis, number[]>>>,
  boundary: Ref<Record<LPSAxis, number[]>>
): ComputedRef<CropLines<LPSPoint> | null> {
  const currentSlice = useCurrentSlice(viewID);

  return computed(() => {
    // pre-check reactivity
    const viewIDVal = viewID.value;
    const cropAxisVal = cropAxis.value;
    const cropPlanesVal = cropPlanes.value;
    const boundaryVal = boundary.value;
    const sliceInfo = currentSlice.value;

    if (!viewIDVal || !cropAxisVal || !sliceInfo) {
      return null;
    }

    const sliceAxis = sliceInfo.axisName;
    const [perpAxis] = LPSAxes.filter(
      (ax) => ax !== cropAxisVal && ax !== sliceAxis
    );
    const cropRange = cropPlanesVal[cropAxisVal];
    const perpRange = cropPlanesVal[perpAxis];
    const perpBoundary = boundaryVal[perpAxis];

    const sliceCropRange = cropPlanesVal[sliceAxis];
    const slice = sliceInfo.number;
    const outOfBounds = slice < sliceCropRange[0] || sliceCropRange[1] < slice;

    const getLineSegments = (index: number) => {
      const startEdge = createLPSPoint();
      const startCrop = createLPSPoint();
      const endCrop = createLPSPoint();
      const endEdge = createLPSPoint();

      startEdge[cropAxisVal] = cropRange[index];
      startCrop[cropAxisVal] = cropRange[index];
      endCrop[cropAxisVal] = cropRange[index];
      endEdge[cropAxisVal] = cropRange[index];

      [startEdge[perpAxis], endEdge[perpAxis]] = perpBoundary;
      [startCrop[perpAxis], endCrop[perpAxis]] = perpRange;

      return { startEdge, startCrop, endCrop, endEdge };
    };

    return {
      lowerLine: getLineSegments(0),
      upperLine: getLineSegments(1),
      outOfBounds,
    };
  });
}

function cropLinesToSVGDisplay(
  cropLines: Ref<CropLines<LPSPoint> | null>,
  imageMetadata: Ref<ImageMetadata>,
  renderer: Ref<vtkRenderer>
): ComputedRef<CropLines<number[]> | null> {
  // gather points
  const worldPoints = computed(() => {
    const lines = cropLines.value;
    const { lpsOrientation, indexToWorld } = imageMetadata.value;
    if (!lines) {
      return null;
    }
    return [
      lines.lowerLine.startEdge,
      lines.lowerLine.startCrop,
      lines.lowerLine.endCrop,
      lines.lowerLine.endEdge,
      lines.upperLine.startEdge,
      lines.upperLine.startCrop,
      lines.upperLine.endCrop,
      lines.upperLine.endEdge,
    ].map((indexLPSPoint) => {
      const indexPt = [0, 0, 0] as vec3;
      indexPt[lpsOrientation.Sagittal] = indexLPSPoint.Sagittal;
      indexPt[lpsOrientation.Coronal] = indexLPSPoint.Coronal;
      indexPt[lpsOrientation.Axial] = indexLPSPoint.Axial;

      const out = [0, 0, 0] as vec3;
      vec3.transformMat4(out, indexPt, indexToWorld);
      return out as Vector3;
    });
  });

  // transform points to svg
  const svgPoints = useVTKMultiWorldToSVG(worldPoints, renderer);

  // create a new CropLines with SVG points
  return computed(() => {
    const lines = cropLines.value;
    const points = svgPoints.value;
    if (!lines || !points?.length) {
      return null;
    }

    return {
      lowerLine: {
        startEdge: points[0],
        startCrop: points[1],
        endCrop: points[2],
        endEdge: points[3],
      },
      upperLine: {
        startEdge: points[4],
        startCrop: points[5],
        endCrop: points[6],
        endEdge: points[7],
      },
      outOfBounds: lines.outOfBounds,
    };
  });
}

function useDragging({
  mouseEventToLPSPoint,
  getCropEdgePos,
  setCropEdgePos,
}: {
  mouseEventToLPSPoint: (ev: PointerEvent) => LPSPoint | null;
  getCropEdgePos: (axis: LPSAxis, lowerUpper: 0 | 1) => number;
  setCropEdgePos: (axis: LPSAxis, lowerUpper: 0 | 1, pos: number) => void;
}) {
  const activeAxis = ref<LPSAxis | null>();
  const activeEdge = ref<0 | 1 | null>();
  const initialPointerIndex = ref<LPSPoint>(createLPSPoint());
  const initialCrop = ref<number>(0);

  const onPointerDown = (
    ax: LPSAxis,
    selectedCropEdge: 0 | 1,
    ev: PointerEvent
  ) => {
    // ev -> world -> index -> LPSPoint -> save as starting index
    // save the starting axis edge value
    const initialPoint = mouseEventToLPSPoint(ev);
    if (!initialPoint) return;

    initialPointerIndex.value = initialPoint;
    initialCrop.value = getCropEdgePos(ax, selectedCropEdge);
    activeAxis.value = ax;
    activeEdge.value = selectedCropEdge;
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (activeAxis.value == null || activeEdge.value == null) {
      return;
    }
    const axis = activeAxis.value;

    const point = mouseEventToLPSPoint(ev);
    if (!point) return;

    // calc delta along ax from starting pos via startingIndex
    // apply delta to starting axis edge value
    const delta = point[axis] - initialPointerIndex.value[axis];
    setCropEdgePos(axis, activeEdge.value, initialCrop.value + delta);
  };

  const onPointerUp = () => {
    activeAxis.value = null;
    activeEdge.value = null;
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}

export default defineComponent({
  props: {
    viewId: {
      required: true,
      type: String,
    },
  },
  components: {
    Crop2DLineHandle,
  },
  setup(props) {
    const { viewId: viewID } = toRefs(props);

    const viewStore = useViewStore();
    const viewProxy = computed(
      () => viewStore.getViewProxy<vtkLPSView2DProxy>(viewID.value)!
    );
    const renderer = computed(() => viewProxy.value?.getRenderer());

    const {
      currentImageExtent: imageExtent,
      currentImageID,
      currentImageMetadata,
    } = useCurrentImage();
    const currentSlice = useCurrentSlice(viewID);
    const currentSlicingAxis = computed(
      () => currentSlice.value?.axisName ?? null
    );

    const cropStore = useCropStore();
    const cropPlanes = computed((): DeepReadonly<LPSBounds> => {
      const imageID = currentImageID.value;
      if (imageID && imageID in cropStore.croppingByImageID) {
        return cropStore.croppingByImageID[imageID];
      }
      return createLPSBounds();
    });

    const inPlaneAxes = computed(() =>
      LPSAxes.filter(
        (ax) => currentSlicingAxis.value && ax !== currentSlicingAxis.value
      )
    );
    const ax1 = computed(() => inPlaneAxes.value[0] ?? null);
    const ax2 = computed(() => inPlaneAxes.value[1] ?? null);

    // crop lines in image space
    const ax1Lines = computeCropLines(viewID, ax1, cropPlanes, imageExtent);
    const ax2Lines = computeCropLines(viewID, ax2, cropPlanes, imageExtent);

    // crop lines in display space
    const ax1SVGLines = cropLinesToSVGDisplay(
      ax1Lines,
      currentImageMetadata,
      renderer
    );
    const ax2SVGLines = cropLinesToSVGDisplay(
      ax2Lines,
      currentImageMetadata,
      renderer
    );

    const { onPointerDown, onPointerMove, onPointerUp } = useDragging({
      mouseEventToLPSPoint(ev: PointerEvent) {
        const ren = renderer.value;
        if (!ren) return null;

        const sliceInfo = currentSlice.value;
        if (!sliceInfo) return null;

        const { lpsOrientation, worldToIndex } = currentImageMetadata.value;
        const coord = intersectMouseEventWithPlane(
          ev,
          ren,
          sliceInfo.planeOrigin,
          sliceInfo.planeNormal
        );
        if (!coord) return null;

        // convert from world to index
        vec3.transformMat4(coord, coord, worldToIndex);

        const point = createLPSPoint();
        point.Sagittal = coord[lpsOrientation.Sagittal];
        point.Coronal = coord[lpsOrientation.Coronal];
        point.Axial = coord[lpsOrientation.Axial];

        return point;
      },
      getCropEdgePos(axis: LPSAxis, lowerUpper: 0 | 1) {
        return cropPlanes.value[axis][lowerUpper];
      },
      setCropEdgePos(axis: LPSAxis, lowerUpper: 0 | 1, pos: number) {
        if (!currentImageID.value) return;

        // enforce cropping edge bounds
        const planes = cropPlanes.value;
        const [lower, upper] = planes[axis];
        const [min, max] = imageExtent.value[axis];
        const newPlanes: Vector2 = [lower, upper];
        if (lowerUpper === 0) {
          newPlanes[0] = Math.max(min, Math.min(pos, upper));
        } else if (lowerUpper === 1) {
          newPlanes[1] = Math.max(lower, Math.min(pos, max));
        }

        cropStore.setCroppingForAxis(currentImageID.value, axis, newPlanes);
      },
    });

    return {
      ax1: computed(() => ({
        name: ax1.value,
        lines: ax1SVGLines.value,
      })),
      ax2: computed(() => ({
        name: ax2.value,
        lines: ax2SVGLines.value,
      })),
      onPointerDown,
      onPointerMove,
      onPointerUp,
    };
  },
});
</script>

<template>
  <g>
    <template v-if="ax1.lines != null">
      <crop-2D-line-handle
        :line="ax1.lines.lowerLine"
        :out-of-bounds="ax1.lines.outOfBounds"
        @pointerdown="onPointerDown(ax1.name, 0, $event)"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
      />
      <crop-2D-line-handle
        :line="ax1.lines.upperLine"
        :out-of-bounds="ax1.lines.outOfBounds"
        @pointerdown="onPointerDown(ax1.name, 1, $event)"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
      />
    </template>
    <template v-if="ax2.lines != null">
      <crop-2D-line-handle
        :line="ax2.lines.lowerLine"
        :out-of-bounds="ax2.lines.outOfBounds"
        @pointerdown="onPointerDown(ax2.name, 0, $event)"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
      />
      <crop-2D-line-handle
        :line="ax2.lines.upperLine"
        :out-of-bounds="ax2.lines.outOfBounds"
        @pointerdown="onPointerDown(ax2.name, 1, $event)"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
      />
    </template>
  </g>
</template>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
