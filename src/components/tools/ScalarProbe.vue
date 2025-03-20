<script setup lang="ts">
import { inject, watch, computed, toRefs } from 'vue';
import type { ReadonlyVec3 } from 'gl-matrix';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import vtkPointPicker from '@kitware/vtk.js/Rendering/Core/PointPicker';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { useImageStore } from '@/src/store/datasets-images';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useProbeStore } from '@/src/store/probe';

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
const imageStore = useImageStore();
const layersStore = useLayersStore();
const segmentGroupStore = useSegmentGroupStore();
const probeStore = useProbeStore();

// Helper functions to build a unified sample set
const getBaseSlice = () => {
  if (!currentImageData.value || !currentImageID.value) return null;
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
        name: imageStore.metadata[layer.selection].name,
        rep,
        image: layersStore.layerImages[layer.id],
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
  if (!firstToSample) return undefined;

  pointPicker.pick([x, y, 1.0], view.renderer);
  if (pointPicker.getActors().length === 0) return undefined;

  const ijk = pointPicker.getPointIJK() as unknown as ReadonlyVec3;
  const samples = sampleSet.value.map((item: any) => {
    const dims = item.image.getDimensions();
    const scalarData = item.image.getPointData().getScalars();
    const index = dims[0] * dims[1] * ijk[2] + dims[0] * ijk[1] + ijk[0];
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
  });

  const position = firstToSample.image.indexToWorld(ijk);

  return {
    pos: position,
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
