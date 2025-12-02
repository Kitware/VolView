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
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { get2DViewingVectors } from '@/src/utils/getViewingVectors';
import { worldPointToIndex } from '@/src/utils/imageSpace';
import { Tools } from './types';
import { useSegmentGroupStore } from '../segmentGroups';
import useViewSliceStore from '../view-configs/slicing';
import { useViewStore } from '../views';
import { useViewCameraStore } from '../view-configs/camera';
import { useImageCacheStore } from '../image-cache';

const DEFAULT_BRUSH_SIZE = 4;
const DEFAULT_THRESHOLD_RANGE: Vector2 = [
  Number.NEGATIVE_INFINITY,
  Number.POSITIVE_INFINITY,
];

export const usePaintToolStore = defineStore('paint', () => {
  type _This = ReturnType<typeof usePaintToolStore>;

  const activeMode = ref(PaintMode.CirclePaint);
  const activeSegmentGroupID = ref<Maybe<string>>(null);
  const activeSegment = ref<Maybe<number>>(null);
  const brushSize = ref(DEFAULT_BRUSH_SIZE);
  const strokePoints = ref<vec3[]>([]);
  const isActive = ref(false);
  const thresholdRange = ref<Vector2>([...DEFAULT_THRESHOLD_RANGE]);
  const crossPlaneSync = ref(false);
  const paintPosition = ref<Vector3>([0, 0, 0]);
  const activePaintViewID = ref<Maybe<string>>(null);
  const lastSegmentByGroup = ref<Record<string, number>>({});

  const { currentImageID, currentImageMetadata } = useCurrentImage('global');
  const imageStatsStore = useImageStatsStore();
  const viewSliceStore = useViewSliceStore();
  const viewStore = useViewStore();
  const viewCameraStore = useViewCameraStore();

  function getWidgetFactory(this: _This) {
    return this.$paint.factory;
  }

  const segmentGroupStore = useSegmentGroupStore();

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
    this.$paint.setMode(mode);
  }

  /**
   * Sets the active labelmap.
   */
  function setActiveSegmentGroup(segmentGroupID: Maybe<string>) {
    activeSegmentGroupID.value = segmentGroupID;
  }

  function getValidSegmentGroupID(imageID: Maybe<string>): Maybe<string> {
    if (!imageID) return null;

    // If current segment group belongs to this image, keep using it
    if (
      activeSegmentGroupID.value &&
      segmentGroupStore.metadataByID[activeSegmentGroupID.value]
        ?.parentImage === imageID
    ) {
      return activeSegmentGroupID.value;
    }

    // Otherwise look for other segment groups for this image
    const segmentGroups = segmentGroupStore.orderByParent[imageID];
    if (segmentGroups && segmentGroups.length > 0) {
      return segmentGroups[0];
    }
    return null;
  }

  /**
   * Sets the active labelmap from a given image.
   *
   * If a labelmap exists, pick one. If no labelmap exists, create one.
   */
  function ensureActiveSegmentGroupForImage(imageID: Maybe<string>) {
    if (!imageID) {
      setActiveSegmentGroup(null);
      return;
    }

    const segmentGroupID =
      getValidSegmentGroupID(imageID) ??
      segmentGroupStore.newLabelmapFromImage(imageID);
    setActiveSegmentGroup(segmentGroupID);
  }

  /**
   * Sets the active segment.
   *
   * If the segment may be null | undefined, indicating no paint will occur.
   * @param segValue
   */
  function setActiveSegment(this: _This, segValue: Maybe<number>) {
    if (segValue) {
      if (!activeSegmentGroupID.value)
        throw new Error('Cannot set active segment without a labelmap');

      const { segments } =
        segmentGroupStore.metadataByID[activeSegmentGroupID.value];

      if (!(segValue in segments.byValue))
        throw new Error('Segment is not available for the active labelmap');

      lastSegmentByGroup.value[activeSegmentGroupID.value] = segValue;
    }

    activeSegment.value = segValue;
    this.$paint.setBrushValue(segValue);
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
    const segmentGroupID = getValidSegmentGroupID(imageID);
    if (!segmentGroupID) return;

    const labelmap = segmentGroupStore.dataIndex[segmentGroupID];
    if (!labelmap) return;

    // Prevent painting if active segment is locked or doesn't exist
    if (activeSegment.value) {
      const metadata = segmentGroupStore.metadataByID[segmentGroupID];
      if (!metadata) return;

      const segment = metadata.segments.byValue[activeSegment.value];
      if (!segment || segment.locked) {
        return;
      }
    }

    const imageData = useImageCacheStore().getVtkImageData(imageID);
    const underlyingImagePixels = imageData
      ?.getPointData()
      .getScalars()
      .getData();
    const [minThreshold, maxThreshold] = thresholdRange.value;
    const shouldPaint = (idx: number) => {
      if (!underlyingImagePixels) return false;

      // Prevent painting over locked segments
      const metadata = segmentGroupStore.metadataByID[segmentGroupID];
      if (metadata) {
        const currentData = labelmap
          .getPointData()
          .getScalars()
          .getData() as Uint8Array;
        const currentValue = currentData[idx];
        const segment = metadata.segments.byValue[currentValue];
        if (segment?.locked) {
          return false;
        }
      }

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

  function switchToSegmentGroupForImage(this: _This, imageID: string) {
    const segmentGroupID =
      getValidSegmentGroupID(imageID) ??
      segmentGroupStore.newLabelmapFromImage(imageID);

    if (!segmentGroupID) {
      throw new Error(
        `Failed to create or find segment group for image ${imageID}`
      );
    }

    if (activeSegmentGroupID.value === segmentGroupID) return;

    setActiveSegmentGroup(segmentGroupID);

    const metadata = segmentGroupStore.metadataByID[segmentGroupID];
    if (!metadata) return;

    const lastSegment = lastSegmentByGroup.value[segmentGroupID];
    if (lastSegment !== undefined && lastSegment in metadata.segments.byValue) {
      setActiveSegment.call(this, lastSegment);
      return;
    }

    if (metadata.segments.order.length > 0) {
      setActiveSegment.call(this, metadata.segments.order[0]);
    }
  }

  function startStroke(
    this: _This,
    worldPoint: vec3,
    axisIndex: 0 | 1 | 2,
    imageID: string
  ) {
    switchToSegmentGroupForImage.call(this, imageID);
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
    ensureActiveSegmentGroupForImage(imageID);
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

      // Update slice position
      const { viewDirection } = get2DViewingVectors(view.options.orientation);
      const axis = getLPSAxisFromDir(viewDirection);
      const index = lpsOrientation[axis];
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

  function serialize(state: StateFile) {
    const paint = state.manifest.tools?.paint;
    if (!paint) return;

    paint.activeSegmentGroupID = activeSegmentGroupID.value ?? null;
    paint.brushSize = brushSize.value;
    paint.activeSegment = activeSegment.value;
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

    if (paint.activeSegmentGroupID) {
      activeSegmentGroupID.value =
        segmentGroupIDMap[paint.activeSegmentGroupID];
      setActiveSegmentGroup(activeSegmentGroupID.value);
      setActiveSegment.call(this, paint.activeSegment);
    }
    setCrossPlaneSync(paint.crossPlaneSync ?? false);
  }

  return {
    activeMode,
    activeSegmentGroupID,
    activeSegment,
    brushSize,
    strokePoints,
    isActive,
    thresholdRange,
    crossPlaneSync,

    getWidgetFactory,

    activateTool,
    deactivateTool,

    setMode,
    setActiveSegmentGroup,
    setActiveSegment,
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
