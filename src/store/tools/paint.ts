import type { Vector2, Vector3 } from '@kitware/vtk.js/types';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import type { Maybe } from '@/src/types';
import { useImageStatsStore } from '@/src/store/image-stats';
import { computed, ref, unref, watch } from 'vue';
import { watchImmediate } from '@vueuse/core';
import { vec3 } from 'gl-matrix';
import { defineStore } from 'pinia';
import { PaintMode } from '@/src/core/tools/paint';
import { computeEffectiveView } from '@/src/core/views/effectiveView';
import { worldPointToIndex } from '@/src/utils/imageSpace';
import { Tools } from './types';
import { useSegmentationStore } from '../segmentations';
import useViewSliceStore from '../view-configs/slicing';
import { useViewStore } from '../views';
import { useViewCameraStore } from '../view-configs/camera';
import { useImageCacheStore } from '../image-cache';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import { isRecord } from '@/src/utils';

// wire-format shim, replaced in C7
declareManifestRefs('tools.paint', (manifest) => {
  const tools = isRecord(manifest.tools) ? manifest.tools : {};
  const paint = isRecord(tools.paint) ? tools.paint : {};
  return typeof paint.activeSegmentGroupID === 'string'
    ? [
        {
          kind: 'segmentGroup' as const,
          id: paint.activeSegmentGroupID,
          where: 'tools.paint.activeSegmentGroupID',
        },
      ]
    : [];
});

const DEFAULT_BRUSH_SIZE = 4;
const DEFAULT_THRESHOLD_RANGE: Vector2 = [
  Number.NEGATIVE_INFINITY,
  Number.POSITIVE_INFINITY,
];

export const usePaintToolStore = defineStore('paint', () => {
  type _This = ReturnType<typeof usePaintToolStore>;

  const activeMode = ref(PaintMode.CirclePaint);
  const modeBeforeProcess = ref(PaintMode.CirclePaint);
  const processControlsOpen = ref(false);
  const brushSize = ref(DEFAULT_BRUSH_SIZE);
  const strokePoints = ref<vec3[]>([]);
  const isActive = ref(false);
  const thresholdRange = ref<Vector2>([...DEFAULT_THRESHOLD_RANGE]);
  const crossPlaneSync = ref(false);
  const paintPosition = ref<Vector3>([0, 0, 0]);
  const activePaintViewID = ref<Maybe<string>>(null);

  const { currentImageID, currentImageMetadata } = useCurrentImage('global');
  const imageStatsStore = useImageStatsStore();
  const viewSliceStore = useViewSliceStore();
  const viewStore = useViewStore();
  const viewCameraStore = useViewCameraStore();

  function getWidgetFactory(this: _This) {
    return this.$paint.factory;
  }

  const segmentationStore = useSegmentationStore();

  const isPaintingModeActive = computed(
    () =>
      activeMode.value === PaintMode.CirclePaint ||
      activeMode.value === PaintMode.Erase
  );
  const activePaintMode = computed(() =>
    isPaintingModeActive.value ? activeMode.value : modeBeforeProcess.value
  );

  const currentViewIDs = computed(() => {
    const imageID = unref(currentImageID);
    if (imageID) {
      return viewStore.viewIDs.filter(
        (viewID) => !!viewSliceStore.getConfig(viewID, imageID)
      );
    }
    return [];
  });

  // --- actions --- //

  /**
   * Sets the painting mode.
   * @param mode
   */
  function setMode(this: _This, mode: PaintMode) {
    activeMode.value = mode;
    if (mode === PaintMode.Process) {
      processControlsOpen.value = true;
    } else {
      modeBeforeProcess.value = mode;
    }
    this.$paint.setMode(mode);
  }

  function setProcessControlsOpen(open: boolean) {
    processControlsOpen.value = open;
  }

  function enterProcessMode(this: _This) {
    if (activeMode.value !== PaintMode.Process) {
      modeBeforeProcess.value = activeMode.value;
    }
    activeMode.value = PaintMode.Process;
    processControlsOpen.value = true;
    this.$paint.setMode(PaintMode.Process);
  }

  function restoreModeAfterProcess(this: _This) {
    if (activeMode.value !== PaintMode.Process) return;
    activeMode.value = modeBeforeProcess.value;
    this.$paint.setMode(modeBeforeProcess.value);
  }

  /**
   * The segment this operation writes into, with its storage allocated.
   */
  function resolveStrokeTarget(imageID: string) {
    const target = segmentationStore.resolveEditTarget(imageID);
    const segment = segmentationStore.getSegment(
      target.segmentationId,
      target.segmentId
    );
    if (segment.locked) return undefined;

    const binding = segmentationStore.ensureLabelmapBinding(
      target.segmentationId,
      target.segmentId
    );
    const labelmap = segmentationStore.artifactIndex[binding.artifactId];
    if (!labelmap) return undefined;
    return {
      labelValue: binding.labelValue,
      artifactId: binding.artifactId,
      labelmap,
    };
  }

  /**
   * Sets the brush size
   * @param this
   * @param size
   */
  function setBrushSize(this: _This, size: number) {
    brushSize.value = Math.round(size);
    this.$paint.setBrushSize(size);
  }

  function doPaintStroke(this: _This, axisIndex: 0 | 1 | 2, imageID: string) {
    const target = resolveStrokeTarget(imageID);
    if (!target) return;

    const { labelmap, labelValue } = target;
    this.$paint.setBrushValue(labelValue);

    // One catalog read per stroke: the per-voxel predicate below is the hot path.
    const lockedValues = new Set(
      segmentationStore
        .segmentsForArtifact(target.artifactId)
        .filter((segment) => segment.locked)
        .map((segment) => segment.representations.labelmap!.labelValue)
    );

    const erasing = activeMode.value === PaintMode.Erase;
    const imageData = useImageCacheStore().getVtkImageData(imageID);
    const underlyingImagePixels = imageData
      ?.getPointData()
      .getScalars()
      .getData();
    const [minThreshold, maxThreshold] = thresholdRange.value;
    const shouldPaint = (idx: number) => {
      if (!underlyingImagePixels) return false;

      // Prevent painting over locked segments
      const currentData = labelmap
        .getPointData()
        .getScalars()
        .getData() as Uint8Array;
      if (lockedValues.has(currentData[idx])) {
        return false;
      }

      // Erase clears the active segment only.
      if (erasing && currentData[idx] !== labelValue) return false;

      const pixValue = underlyingImagePixels[idx];
      return minThreshold <= pixValue && pixValue <= maxThreshold;
    };

    const lastIndex = strokePoints.value.length - 1;
    if (lastIndex >= 0) {
      const lastWorldPoint = strokePoints.value[lastIndex];
      const prevWorldPoint =
        lastIndex >= 1 ? strokePoints.value[lastIndex - 1] : undefined;

      const lastIndexPoint = worldPointToIndex(labelmap, lastWorldPoint);
      const prevIndexPoint = prevWorldPoint
        ? worldPointToIndex(labelmap, prevWorldPoint)
        : undefined;

      this.$paint.paintLabelmap(
        labelmap,
        axisIndex,
        lastIndexPoint,
        prevIndexPoint,
        shouldPaint
      );
    }
  }

  function setSliceAxis(this: _This, axisIndex: 0 | 1 | 2, imageID: string) {
    const imageData = useImageCacheStore().getVtkImageData(imageID);
    if (!imageData) return;

    const spacing = [...imageData.getSpacing()];
    spacing.splice(axisIndex, 1);
    const scale: Vector2 = [1 / spacing[0], 1 / spacing[1]];
    this.$paint.setBrushScale(scale);
  }

  function startStroke(
    this: _This,
    worldPoint: vec3,
    axisIndex: 0 | 1 | 2,
    imageID: string
  ) {
    strokePoints.value = [vec3.clone(worldPoint)];
    doPaintStroke.call(this, axisIndex, imageID);
  }

  function placeStrokePoint(
    this: _This,
    worldPoint: vec3,
    axisIndex: 0 | 1 | 2,
    imageID: string
  ) {
    strokePoints.value.push(worldPoint);
    doPaintStroke.call(this, axisIndex, imageID);
  }

  function endStroke(
    this: _This,
    worldPoint: vec3,
    axisIndex: 0 | 1 | 2,
    imageID: string
  ) {
    strokePoints.value.push(worldPoint);
    doPaintStroke.call(this, axisIndex, imageID);
  }

  const currentImageStats = computed(() => {
    if (!currentImageID.value) return null;
    return imageStatsStore.stats[currentImageID.value];
  });

  function resetThresholdRange(imageID: Maybe<string>) {
    if (imageID) {
      const stats = imageStatsStore.stats[imageID];
      if (stats) {
        thresholdRange.value = [stats.scalarMin, stats.scalarMax];
      } else {
        thresholdRange.value = [...DEFAULT_THRESHOLD_RANGE];
      }
    }
  }

  watchImmediate([currentImageID, currentImageStats], ([id]) => {
    resetThresholdRange(id);
  });

  // --- setup and teardown --- //

  function activateTool(this: _This) {
    const imageID = currentImageID.value;
    if (!imageID) {
      return false;
    }
    const target = segmentationStore.resolveEditTarget(imageID);
    segmentationStore.ensureLabelmapBinding(
      target.segmentationId,
      target.segmentId
    );
    this.$paint.setBrushSize(this.brushSize);

    isActive.value = true;
    return true;
  }

  function deactivateTool() {
    isActive.value = false;
  }

  function setThresholdRange(this: _This, range: Vector2) {
    thresholdRange.value = range;
  }

  function setCrossPlaneSync(enabled: boolean) {
    crossPlaneSync.value = enabled;
  }

  watch(paintPosition, (worldPosition) => {
    if (!crossPlaneSync.value || !isActive.value) return;

    const imageID = unref(currentImageID);
    const metadata = unref(currentImageMetadata);
    if (!imageID || !metadata?.lpsOrientation || !metadata?.worldToIndex)
      return;

    const { lpsOrientation, worldToIndex } = metadata;
    const indexPos = vec3.create();
    vec3.transformMat4(indexPos, worldPosition, worldToIndex);

    currentViewIDs.value.forEach((viewID) => {
      const sliceConfig = viewSliceStore.getConfig(viewID, imageID);
      if (!sliceConfig) return;

      // Get view to determine axis direction
      const view = viewStore.getView(viewID);
      if (!view || view.type !== '2D') return;

      const effective = computeEffectiveView(view, imageID);
      if (effective.kind !== 'volume2D') return;

      // Update slice position
      const index = lpsOrientation[effective.axis];
      const slice = Math.round(indexPos[index]);
      if (slice !== sliceConfig.slice) {
        viewSliceStore.updateConfig(viewID, imageID, { slice });
      }

      // Center camera on paint position (skip active view)
      if (activePaintViewID.value && viewID === activePaintViewID.value) {
        return;
      }
      viewCameraStore.updateConfig(viewID, imageID, {
        focalPoint: worldPosition,
      });
    });
  });

  function updatePaintPosition(worldPosition: Vector3, activeViewID?: string) {
    paintPosition.value = worldPosition;
    activePaintViewID.value = activeViewID;
  }

  // wire-format shim, replaced in C7
  const activeBinding = () => {
    const target = segmentationStore.activeTarget;
    if (!target) return undefined;
    return segmentationStore.resolveLabelmapBinding(
      target.segmentationId,
      target.segmentId
    );
  };

  function serialize(state: StateFile) {
    const paint = state.manifest.tools?.paint;
    if (!paint) return;

    // wire-format shim, replaced in C7
    const binding = activeBinding();
    paint.activeSegmentGroupID = binding?.artifactId ?? null;
    paint.activeSegment = binding?.labelValue ?? null;
    paint.brushSize = brushSize.value;
    paint.crossPlaneSync = crossPlaneSync.value;
  }

  function deserialize(
    this: _This,
    manifest: Manifest,
    segmentGroupIDMap: Record<string, string>
  ) {
    const paint = manifest.tools?.paint;
    if (!paint) return;

    if (paint.brushSize !== undefined) {
      setBrushSize.call(this, paint.brushSize);
    }
    isActive.value = manifest.tools?.current === Tools.Paint;

    // wire-format shim, replaced in C7
    const artifactId = paint.activeSegmentGroupID
      ? segmentGroupIDMap[paint.activeSegmentGroupID]
      : undefined;
    const segmentation = artifactId
      ? segmentationStore.getSegmentationForArtifact(artifactId)
      : undefined;
    const segment =
      artifactId && paint.activeSegment != null
        ? segmentationStore.findSegmentByLabelValue(
            artifactId,
            paint.activeSegment
          )
        : undefined;
    if (segmentation && segment) {
      segmentationStore.setActiveSegment(segmentation.id, segment.id);
    }
    setCrossPlaneSync(paint.crossPlaneSync ?? false);
  }

  return {
    activeMode,
    activePaintMode,
    processControlsOpen,
    brushSize,
    strokePoints,
    isActive,
    isPaintingModeActive,
    thresholdRange,
    crossPlaneSync,

    getWidgetFactory,

    activateTool,
    deactivateTool,

    setMode,
    setProcessControlsOpen,
    enterProcessMode,
    restoreModeAfterProcess,
    setBrushSize,
    setSliceAxis,
    setThresholdRange,
    setCrossPlaneSync,
    updatePaintPosition,
    startStroke,
    placeStrokePoint,
    endStroke,
    serialize,
    deserialize,
  };
});
