import type { Vector2 } from '@kitware/vtk.js/types';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { computed, ref, watch } from 'vue';
import { vec3 } from 'gl-matrix';
import { defineStore } from 'pinia';
import { Maybe } from '@/src/types';
import { Tools } from './types';
import { useLabelmapStore } from '../datasets-labelmaps';

const DEFAULT_BRUSH_SIZE = 4;

export const usePaintToolStore = defineStore('paint', () => {
  type _This = ReturnType<typeof usePaintToolStore>;

  const activeLabelmapID = ref<string | null>(null);
  const activeSegment = ref<Maybe<number>>(null);
  const brushSize = ref(DEFAULT_BRUSH_SIZE);
  const strokePoints = ref<vec3[]>([]);
  const labelmapOpacity = ref(1);
  const isActive = ref(false);

  const { currentImageID } = useCurrentImage();

  function getWidgetFactory(this: _This) {
    return this.$paint.factory;
  }

  const activeLabelmap = computed(() => {
    if (!activeLabelmapID.value) return null;
    const labelmapStore = useLabelmapStore();
    return labelmapStore.dataIndex[activeLabelmapID.value] ?? null;
  });

  // --- actions --- //

  /**
   * Sets the active labelmap.
   */
  function setActiveLabelmap(labelmapID: string | null) {
    activeLabelmapID.value = labelmapID;
  }

  /**
   * Sets the active labelmap from a given image.
   *
   * If a labelmap exists, pick the first one. If no labelmap exists, create one.
   */
  function setActiveLabelmapFromImage(imageID: string | null) {
    if (!imageID) {
      setActiveLabelmap(null);
      return;
    }

    const labelmapStore = useLabelmapStore();
    const labelmaps = labelmapStore.orderByParent[imageID];
    if (labelmaps?.length) {
      activeLabelmapID.value = labelmaps[0];
    } else {
      activeLabelmapID.value = labelmapStore.newLabelmapFromImage(imageID);
    }
  }

  /**
   * Sets the active segment.
   *
   * If the segment may be null | undefined, indicating no paint will occur.
   * @param segValue
   */
  function setActiveSegment(this: _This, segValue: Maybe<number>) {
    if (segValue) {
      if (!activeLabelmapID.value)
        throw new Error('Cannot set active segment without a labelmap');

      const labelmapStore = useLabelmapStore();
      const { segments } =
        labelmapStore.labelmapMetadata[activeLabelmapID.value];

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

  function setLabelmapOpacity(opacity: number) {
    labelmapOpacity.value = Math.min(1, Math.max(0, opacity));
  }

  function doPaintStroke(this: _This, axisIndex: 0 | 1 | 2) {
    if (!activeLabelmap.value) {
      return;
    }

    const lastIndex = strokePoints.value.length - 1;
    if (lastIndex >= 0) {
      const lastPoint = strokePoints.value[lastIndex];
      const prevPoint =
        lastIndex >= 1 ? strokePoints.value[lastIndex - 1] : undefined;
      this.$paint.paintLabelmap(
        activeLabelmap.value,
        axisIndex,
        lastPoint,
        prevPoint
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

  function startStroke(this: _This, indexPoint: vec3, axisIndex: 0 | 1 | 2) {
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

  // --- setup and teardown --- //

  function activateTool(this: _This) {
    const imageID = currentImageID.value;
    if (!imageID) {
      return false;
    }
    setActiveLabelmapFromImage(imageID);
    this.$paint.setBrushSize(this.brushSize);

    isActive.value = true;
    return true;
  }

  function deactivateTool() {
    activeLabelmapID.value = null;
    isActive.value = false;
  }

  function serialize(state: StateFile) {
    const { paint } = state.manifest.tools;

    paint.activeLabelmapID = activeLabelmapID.value;
    paint.brushSize = brushSize.value;
    paint.activeSegment = activeSegment.value;
    paint.labelmapOpacity = labelmapOpacity.value;
  }

  function deserialize(
    this: _This,
    manifest: Manifest,
    labelmapIDMap: Record<string, string>
  ) {
    const { paint } = manifest.tools;
    setBrushSize.call(this, paint.brushSize);
    setActiveSegment.call(this, paint.activeSegment);
    setLabelmapOpacity.call(this, paint.labelmapOpacity);
    isActive.value = manifest.tools.current === Tools.Paint;

    if (paint.activeLabelmapID !== null) {
      activeLabelmapID.value = labelmapIDMap[paint.activeLabelmapID];
    }
  }

  // --- change labelmap if paint is active --- //

  watch(
    currentImageID,
    (imageID) => {
      if (isActive.value) {
        setActiveLabelmapFromImage(imageID);
      }
    },
    { immediate: true }
  );

  return {
    // state
    activeLabelmapID,
    activeSegment,
    brushSize,
    strokePoints,
    labelmapOpacity,
    isActive,

    getWidgetFactory,

    activateTool,
    deactivateTool,

    setActiveLabelmap,
    setActiveLabelmapFromImage,
    setActiveSegment,
    setBrushSize,
    setLabelmapOpacity,
    setSliceAxis,
    startStroke,
    placeStrokePoint,
    endStroke,
    serialize,
    deserialize,
  };
});
