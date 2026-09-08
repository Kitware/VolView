<script setup lang="ts">
import { inject, watch, computed, toRefs } from 'vue';
import type { ReadonlyVec3 } from 'gl-matrix';
import { vec3 } from 'gl-matrix';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { worldPointToIndex } from '@/src/utils/imageSpace';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import vtkPointPicker from '@kitware/vtk.js/Rendering/Core/PointPicker';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';
import { useProbeStore } from '@/src/store/probe';
import { useImageCacheStore } from '@/src/store/image-cache';
import { NO_NAME } from '@/src/constants';

type SliceRepresentationType = ReturnType<typeof useSliceRepresentation>;

const props = defineProps<{
  baseRep: SliceRepresentationType;
  layerReps: SliceRepresentationType[];
  segmentReps: SliceRepresentationType[];
}>();

const { baseRep, layerReps, segmentReps } = toRefs(props);
const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const {
  currentImageID,
  currentImageData,
  currentImageMetadata,
  currentLayers,
} = useCurrentImage();
const imageCacheStore = useImageCacheStore();
const segmentationStore = useSegmentationStore();
const { segments: segments } = useSegmentStore();
const probeStore = useProbeStore();

// Helper functions to build a unified sample set
const getBaseSlice = () => {
  if (!currentImageData.value || !currentImageID.value || !baseRep.value) {
    return null;
  }
  return {
    type: 'layer',
    id: currentImageID.value,
    name: currentImageMetadata.value.name,
    rep: baseRep.value,
    image: currentImageData.value,
  };
};

const getLayers = () =>
  layerReps.value
    .map((rep, index) => {
      const layer = currentLayers.value[index];
      if (!layer) return null;
      return {
        type: 'layer',
        id: layer.id,
        name:
          imageCacheStore.getImageMetadata(layer.selection)?.name ?? NO_NAME,
        rep,
        image: imageCacheStore.getVtkImageData(layer.id),
      };
    })
    .filter(Boolean);

// Paired positionally with the slice view's segment actors, which come off the
// same ordered list.
const getSegments = () => {
  if (!currentImageID.value) return [];
  const layers = segmentationStore.maskLayersForImage(currentImageID.value);
  return segmentReps.value
    .map((rep, index) => {
      const layer = layers[index];
      if (!layer) return null;
      const segment = segmentationStore.getMask(layer.maskId);
      const voxels = segmentationStore.findMaskVoxels(layer.maskId);
      if (!voxels.exists()) return null;
      const catalog =
        segmentationStore.labelmapSegmentsByMask[layer.maskId] ?? [];
      return {
        type: 'segment',
        id: layer.maskId,
        name: segments.appearanceOf(segment.segmentId).name,
        rep,
        nameByLabelValue: Object.fromEntries(
          catalog.map((entry) => [entry.value, entry.name])
        ),
        image: voxels.image(),
      };
    })
    .filter(Boolean);
};

const sampleSet = computed(() => {
  const base = getBaseSlice();
  if (!base) return [];
  return [...getSegments(), ...getLayers(), base];
});

const pointPicker = vtkPointPicker.newInstance();
pointPicker.setPickFromList(true);

watch(
  () => baseRep.value?.actor,
  (actor) => {
    pointPicker.setPickList(actor ? [actor] : []);
  },
  { immediate: true }
);

const getImageSamples = (x: number, y: number) => {
  if (!currentImageData.value) return undefined;

  pointPicker.pick([x, y, 1.0], view.renderer);
  if (pointPicker.getActors().length === 0) return undefined;

  // Get world position from the picked point (in base image space)
  const pickedIjk = pointPicker.getPointIJK() as unknown as ReadonlyVec3;
  const worldPosition = vec3.clone(
    currentImageData.value.indexToWorld(pickedIjk) as vec3
  );

  const samples = sampleSet.value
    .map((item: any) => {
      // Convert world position to this specific image's IJK
      const itemIjk = worldPointToIndex(item.image, worldPosition);
      const dims = item.image.getDimensions();
      const scalarData = item.image.getPointData().getScalars();

      // Round to nearest integer indices
      const i = Math.round(itemIjk[0]);
      const j = Math.round(itemIjk[1]);
      const k = Math.round(itemIjk[2]);

      // Check bounds
      if (
        i < 0 ||
        j < 0 ||
        k < 0 ||
        i >= dims[0] ||
        j >= dims[1] ||
        k >= dims[2]
      ) {
        return null;
      }

      const index = dims[0] * dims[1] * k + dims[0] * j + i;
      const scalars = scalarData.getTuple(index) as number[];
      const baseInfo = { id: item.id, name: item.name };

      if (item.type === 'segment') {
        return {
          ...baseInfo,
          displayValues: scalars.map(
            (v) => item.nameByLabelValue[v] || 'Background'
          ),
        };
      }
      return { ...baseInfo, displayValues: scalars };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return {
    pos: worldPosition,
    samples,
  };
};

onVTKEvent(view.interactor, 'onMouseMove', (event: any) => {
  const samples = getImageSamples(event.position.x, event.position.y);
  probeStore.updateProbeData(samples);
});

onVTKEvent(view.interactor, 'onPointerLeave', () => {
  probeStore.clearProbeData();
});

watch([currentImageID, sampleSet], () => {
  probeStore.clearProbeData();
});
</script>

<template><slot></slot></template>
