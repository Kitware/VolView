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
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useProbeStore } from '@/src/store/probe';
import { useImageCacheStore } from '@/src/store/image-cache';
import { NO_NAME } from '@/src/constants';

type SliceRepresentationType = ReturnType<typeof useSliceRepresentation>;

const props = defineProps<{
  baseRep: SliceRepresentationType;
  layerReps: SliceRepresentationType[];
  segmentGroupsReps: SliceRepresentationType[];
}>();

const { baseRep, layerReps, segmentGroupsReps } = toRefs(props);
const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const {
  currentImageID,
  currentImageData,
  currentImageMetadata,
  currentLayers,
} = useCurrentImage();
const imageCacheStore = useImageCacheStore();
const segmentGroupStore = useSegmentGroupStore();
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

const getSegments = () => {
  if (!currentImageID.value) return [];
  const parentGroups = segmentGroupStore.orderByParent[currentImageID.value];
  if (!parentGroups) return [];
  return segmentGroupsReps.value
    .map((rep, index) => {
      const groupId = parentGroups[index];
      if (!groupId) return null;
      const meta = segmentGroupStore.metadataByID[groupId];
      return {
        type: 'segmentGroup',
        id: groupId,
        name: meta.name,
        rep,
        segments: meta.segments,
        image: segmentGroupStore.dataIndex[groupId],
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
  sampleSet,
  (samples) => {
    pointPicker.setPickList(
      samples.length > 0 && samples[0] ? [samples[0].rep.actor] : []
    );
  },
  { immediate: true }
);

const getImageSamples = (x: number, y: number) => {
  const firstToSample = sampleSet.value[0];
  if (!firstToSample?.image) return undefined;

  pointPicker.pick([x, y, 1.0], view.renderer);
  if (pointPicker.getActors().length === 0) return undefined;

  // Get world position from the picked point
  const pickedIjk = pointPicker.getPointIJK() as unknown as ReadonlyVec3;
  const worldPosition = vec3.clone(
    firstToSample.image.indexToWorld(pickedIjk) as vec3
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

      if (item.type === 'segmentGroup') {
        return {
          ...baseInfo,
          displayValues: scalars.map(
            (v) => item.segments.byValue[v]?.name || 'Background'
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
