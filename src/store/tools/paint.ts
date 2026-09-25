import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import type { Vector2, Vector3 } from '@kitware/vtk.js/types';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import type { Maybe } from '@/src/types';
import { useImageStatsStore } from '@/src/store/image-stats';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { computed, ref, unref, watch } from 'vue';
import { watchImmediate } from '@vueuse/core';
import { vec3 } from 'gl-matrix';
import { defineStore } from 'pinia';
import { PaintMode } from '@/src/core/tools/paint';
import { computeEffectiveView } from '@/src/core/views/effectiveView';
import { worldPointToIndex } from '@/src/utils/imageSpace';
import { maskScalars } from '@/src/segmentation/model';
import {
  clipExtent,
  fullExtent,
  isEmptyExtent,
} from '@/src/segmentation/geometry';
import { Tools } from './types';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import useViewSliceStore from '../view-configs/slicing';
import { useViewStore } from '../views';
import { useViewCameraStore } from '../view-configs/camera';
import { useImageCacheStore } from '../image-cache';

const DEFAULT_BRUSH_SIZE = 4;

// Growing a mask copies the whole of it, so a stroke that has to grow it asks
// for room beyond its footprint and the samples that follow grow nothing.
const STROKE_GROWTH_PADDING = 16;
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
      activeMode.value === PaintMode.Erase ||
      activeMode.value === PaintMode.Eyedropper
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
   * The segment this operation writes into. It is allocated for a stroke that
   * writes voxels; an erase takes what is already there, so it resolves nothing
   * into existence and refuses when there is nothing stored to take from.
   */
  function resolveStrokeTarget(imageID: string, allocate: boolean) {
    if (![PaintMode.CirclePaint, PaintMode.Erase].includes(activeMode.value))
      return undefined;
    const maskId = allocate
      ? segmentationStore.resolveEditTarget(imageID)
      : segmentationStore.findEditTarget(imageID);
    if (!maskId) return undefined;

    const binding = allocate
      ? segmentationStore.ensureLabelmapBinding(maskId)
      : segmentationStore.findMaskBinding(maskId);
    if (!binding) return undefined;

    return {
      maskId,
      labelValue: SEGMENT_VALUE,
      voxels: segmentationStore.maskVoxels(maskId),
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

  function selectSegmentAt(worldPoint: vec3, imageID: string) {
    const registry = useSegmentStore().segments;
    // The eyedropper takes the first registry entry covering the point,
    // including locked segments.
    const segments = registry.segmentList.value;
    const hit = segments.find((segment) => {
      if (!registry.appearanceOf(segment.id).visible) return false;
      const binding = segmentationStore.maskFor(imageID, segment.id)
        ?.representations.labelmap;
      if (!binding || isEmptyExtent(binding.extent)) return false;
      const point = [...worldPointToIndex(binding.image, worldPoint)].map(
        Math.round
      );
      const dims = binding.image.getDimensions();
      if (point.some((value, axis) => value < 0 || value >= dims[axis]))
        return false;
      const [i, j, k] = point;
      return (
        maskScalars(binding.image)[i + dims[0] * (j + dims[1] * k)] ===
        SEGMENT_VALUE
      );
    });
    if (hit) registry.selectSegment(hit.id);
  }

  function doPaintStroke(this: _This, axisIndex: 0 | 1 | 2, imageID: string) {
    // Asked before anything else: cancelling a preview and resolving the target
    // (which mints the mask and its segmentation) are both side effects a
    // refused stroke must not have.
    if (segmentationStore.editTargetLocked()) return;
    useSegmentationEditsStore().beforeEdit();
    const erasing = activeMode.value === PaintMode.Erase;
    const target = resolveStrokeTarget(imageID, !erasing);
    if (!target) return;

    const { voxels, labelValue, maskId } = target;
    this.$paint.setBrushValue(labelValue);

    const parentImage = useImageCacheStore().getVtkImageData(imageID);
    if (!parentImage) return;
    const underlyingImagePixels = parentImage
      .getPointData()
      .getScalars()
      .getData();

    const lastIndex = strokePoints.value.length - 1;
    if (lastIndex < 0) return;

    // The stroke is stated in PARENT index space: a bounded mask's own origin
    // moves as it grows, so its indices are not a fixed frame to state it in.
    const lastIndexPoint = worldPointToIndex(
      parentImage,
      strokePoints.value[lastIndex]
    );
    const prevIndexPoint =
      lastIndex >= 1
        ? worldPointToIndex(parentImage, strokePoints.value[lastIndex - 1])
        : undefined;

    const strokeExtent = clipExtent(
      this.$paint.strokeBounds(axisIndex, lastIndexPoint, prevIndexPoint),
      fullExtent(parentImage.getDimensions())
    );
    // Growth happens first, and nothing grows once the buffers below are read.
    if (!erasing) {
      voxels.ensureContains(strokeExtent, STROKE_GROWTH_PADDING);
    }

    const { extent } = voxels.binding()!;
    if (isEmptyExtent(extent)) return;

    // Resolved once per stroke: the claim below is made for every voxel the
    // brush touches. A stroke is aimed at a place, so it takes the voxel from
    // an unlocked neighbour.
    const claimVoxel = erasing
      ? undefined
      : segmentationStore.voxelClaim(maskId, 'aimed', strokeExtent);
    const parentDimensions = parentImage.getDimensions();
    const rowStride = parentDimensions[0];
    const sliceStride = parentDimensions[0] * parentDimensions[1];
    const maskData = voxels.scalars();
    const [minThreshold, maxThreshold] = thresholdRange.value;

    // The brush walks the PARENT grid and hands its points back in it, so the
    // parent pixel under a voxel is a plain offset. Read a component at a
    // time: the callback below runs for every voxel the brush touches, and a
    // triple per voxel is an allocation per voxel.
    const parentOffset = (point: number[]) =>
      point[0] + point[1] * rowStride + point[2] * sliceStride;

    const shouldPaint = (offset: number, point: number[]) => {
      // Erase clears the active segment only.
      if (erasing && maskData[offset] !== labelValue) return false;

      const pixValue = underlyingImagePixels[parentOffset(point)];
      if (!(minThreshold <= pixValue && pixValue <= maxThreshold)) return false;

      // Asked last: the claim clears the voxel from neighbours, so it runs
      // only for a voxel that is about to be written.
      return claimVoxel?.claim(point[0], point[1], point[2]) ?? true;
    };

    try {
      this.$paint.paintLabelmap(voxels.image(), axisIndex, lastIndexPoint, {
        endPoint: prevIndexPoint,
        // Where this mask's buffer sits on the parent grid the points are in.
        origin: [extent[0], extent[2], extent[4]],
        shouldPaint,
      });
    } finally {
      claimVoxel?.finish();
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
    if (!currentImageID.value) {
      return false;
    }
    // Selecting the tool configures the widget and nothing else. Storage is
    // allocated by the first stroke, so picking up the brush and putting it
    // down again leaves the image untouched.
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

  function serialize(state: StateFile) {
    const paint = state.manifest.tools?.paint;
    if (!paint) return;

    paint.brushSize = brushSize.value;
    paint.crossPlaneSync = crossPlaneSync.value;
  }

  // The active segment rides on its segmentation, restored by the segmentation
  // store before any tool deserializes.
  function deserialize(this: _This, manifest: Manifest) {
    const paint = manifest.tools?.paint;
    if (!paint) return;

    if (paint.brushSize !== undefined) {
      setBrushSize.call(this, paint.brushSize);
    }
    isActive.value = manifest.tools?.current === Tools.Paint;
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
    selectSegmentAt,
    startStroke,
    placeStrokePoint,
    endStroke,
    serialize,
    deserialize,
  };
});
