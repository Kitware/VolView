import type { Vector2 } from '@kitware/vtk.js/types';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import type { Maybe } from '@/src/types';
import { useImageStatsStore } from '@/src/store/image-stats';
import { computed, ref } from 'vue';
import { watchImmediate } from '@vueuse/core';
import { vec3 } from 'gl-matrix';
import { defineStore } from 'pinia';
import { PaintMode } from '@/src/core/tools/paint';
import { Tools } from './types';
import { useSegmentGroupStore } from '../segmentGroups';

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

  const { currentImageID, currentImageData } = useCurrentImage();
  const imageStatsStore = useImageStatsStore();

  function getWidgetFactory(this: _This) {
    return this.$paint.factory;
  }

  const segmentGroupStore = useSegmentGroupStore();

  const activeLabelmap = computed(() => {
    if (!activeSegmentGroupID.value) return null;
    return segmentGroupStore.dataIndex[activeSegmentGroupID.value] ?? null;
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

  function doPaintStroke(this: _This, axisIndex: 0 | 1 | 2) {
    if (!activeLabelmap.value) {
      return;
    }

    // Prevent painting if active segment is locked
    if (activeSegmentGroupID.value && activeSegment.value) {
      const segment = segmentGroupStore.getSegment(
        activeSegmentGroupID.value,
        activeSegment.value
      );
      if (segment?.locked) {
        return;
      }
    }

    const underlyingImagePixels = currentImageData.value
      ?.getPointData()
      .getScalars()
      .getData();
    const [minThreshold, maxThreshold] = thresholdRange.value;
    const shouldPaint = (idx: number) => {
      if (!underlyingImagePixels) return false;

      // Prevent painting over locked segments
      if (activeSegmentGroupID.value && activeLabelmap.value) {
        const metadata =
          segmentGroupStore.metadataByID[activeSegmentGroupID.value];
        if (metadata) {
          const currentData = activeLabelmap.value
            .getPointData()
            .getScalars()
            .getData() as Uint8Array;
          const currentValue = currentData[idx];
          const segment = metadata.segments.byValue[currentValue];
          if (segment?.locked) {
            return false;
          }
        }
      }

      const pixValue = underlyingImagePixels[idx];
      return minThreshold <= pixValue && pixValue <= maxThreshold;
    };

    const lastIndex = strokePoints.value.length - 1;
    if (lastIndex >= 0) {
      const lastPoint = strokePoints.value[lastIndex];
      const prevPoint =
        lastIndex >= 1 ? strokePoints.value[lastIndex - 1] : undefined;
      this.$paint.paintLabelmap(
        activeLabelmap.value,
        axisIndex,
        lastPoint,
        prevPoint,
        shouldPaint
      );
    }
  }

  function setSliceAxis(this: _This, axisIndex: 0 | 1 | 2) {
    if (!activeLabelmap.value) return;
    const spacing = activeLabelmap.value.getSpacing();
    spacing.splice(axisIndex, 1);
    const scale: Vector2 = [1 / spacing[0], 1 / spacing[1]];
    this.$paint.setBrushScale(scale);
  }

  // Create segment group if paint is active and none exist.
  // If paint is not active, but there is a segment group for the current image, set it as active.
  function ensureSegmentGroup() {
    const imageID = currentImageID.value;
    if (!imageID) return;

    // Check if a valid segment group is already selected
    if (
      activeSegmentGroupID.value &&
      segmentGroupStore.metadataByID[activeSegmentGroupID.value]
        ?.parentImage === imageID
    ) {
      return;
    }

    if (isActive.value) {
      ensureActiveSegmentGroupForImage(imageID);
    } else {
      const segmentGroupID = getValidSegmentGroupID(imageID);
      if (segmentGroupID) {
        setActiveSegmentGroup(segmentGroupID);
      }
    }
  }

  function startStroke(this: _This, indexPoint: vec3, axisIndex: 0 | 1 | 2) {
    ensureSegmentGroup();
    strokePoints.value = [vec3.clone(indexPoint)];
    doPaintStroke.call(this, axisIndex);
  }

  function placeStrokePoint(
    this: _This,
    indexPoint: vec3,
    axisIndex: 0 | 1 | 2
  ) {
    strokePoints.value.push(indexPoint);
    doPaintStroke.call(this, axisIndex);
  }

  function endStroke(this: _This, indexPoint: vec3, axisIndex: 0 | 1 | 2) {
    strokePoints.value.push(indexPoint);
    doPaintStroke.call(this, axisIndex);
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

  function serialize(state: StateFile) {
    const { paint } = state.manifest.tools;

    paint.activeSegmentGroupID = activeSegmentGroupID.value ?? null;
    paint.brushSize = brushSize.value;
    paint.activeSegment = activeSegment.value;
  }

  function deserialize(
    this: _This,
    manifest: Manifest,
    segmentGroupIDMap: Record<string, string>
  ) {
    const { paint } = manifest.tools;
    setBrushSize.call(this, paint.brushSize);
    isActive.value = manifest.tools.current === Tools.Paint;

    if (paint.activeSegmentGroupID !== null) {
      activeSegmentGroupID.value =
        segmentGroupIDMap[paint.activeSegmentGroupID];
      setActiveSegmentGroup(activeSegmentGroupID.value);
      setActiveSegment.call(this, paint.activeSegment);
    }
  }

  return {
    activeMode,
    activeSegmentGroupID,
    activeSegment,
    brushSize,
    strokePoints,
    isActive,
    thresholdRange,

    getWidgetFactory,

    activateTool,
    deactivateTool,

    setMode,
    setActiveSegmentGroup,
    setActiveSegment,
    setBrushSize,
    setSliceAxis,
    setThresholdRange,
    startStroke,
    placeStrokePoint,
    endStroke,
    serialize,
    deserialize,
  };
});
