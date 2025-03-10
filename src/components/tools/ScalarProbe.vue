<script setup lang="ts">
import { inject, ref, watch, computed, toRefs } from 'vue';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import vtkPointPicker from '@kitware/vtk.js/Rendering/Core/PointPicker';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { useImageStore } from '@/src/store/datasets-images';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';

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
const sampleSet = computed(() => {
  const baseImage = currentImageData.value;
  if (!baseImage || !currentImageID.value) {
    return [];
  }

  const baseImageSlice = {
    type: 'layer',
    id: currentImageID.value,
    name: currentImageMetadata.value.name,
    rep: baseRep.value,
    image: baseImage,
  } as const;

  const layers = layerReps.value
    // filter out just deleted layers
    .filter((_, index) => currentLayers.value[index] !== undefined)
    .map((layerRep, index) => {
      const layer = currentLayers.value[index];
      return {
        type: 'layer',
        id: layer.id,
        name: imageStore.metadata[layer.selection].name,
        rep: layerRep,
        image: layersStore.layerImages[layer.id],
      } as const;
    });

  const segmentGroups = segmentGroupStore.orderByParent[currentImageID.value];
  const segments = segmentGroupsReps.value
    .map((group, index) => ({ group, index }))
    // filter out just deleted segment groups or on switching current image
    .filter(({ index }) => segmentGroups && segmentGroups[index])
    .map(({ group, index }) => {
      const id = segmentGroups![index];
      const meta = segmentGroupStore.metadataByID[id];
      return {
        type: 'segmentGroup',
        id,
        name: meta.name,
        rep: group,
        segments: meta.segments,
        image: segmentGroupStore.dataIndex[id],
      } as const;
    });

  return [...segments, ...layers, baseImageSlice];
});

const pointPicker = vtkPointPicker.newInstance();
pointPicker.setPickFromList(true);

watch(
  sampleSet,
  (toPick) => {
    pointPicker.setPickList(toPick.map((item) => item.rep.actor));
  },
  { immediate: true }
);

const getImageSamples = (x: number, y: number) => {
  pointPicker.pick([x, y, 1.0], view.renderer);
  if (pointPicker.getActors().length === 0) {
    return undefined;
  }
  const ijk = pointPicker.getPointIJK();
  const samples = sampleSet.value.map((toSample) => {
    const size = toSample.image.getDimensions();
    const scalarData = toSample.image.getPointData().getScalars();
    const scalars = scalarData.getTuple(
      size[0] * size[1] * ijk[2] + size[0] * ijk[1] + ijk[0]
    ) as number[];
    const idName = {
      id: toSample.id,
      name: toSample.name,
    };
    if (toSample.type === 'segmentGroup') {
      return {
        ...idName,
        displayValue: scalars.map(
          (v) => toSample.segments.byValue[v]?.name || 'Background'
        ),
      };
    }
    return {
      ...idName,
      displayValue: scalars,
    };
  });
  const pos = pointPicker.getPickPosition();
  return {
    pos,
    samples,
  };
};

const samples = ref<ReturnType<typeof getImageSamples> | undefined>(undefined);

onVTKEvent(view.interactor, 'onMouseMove', (event: any) => {
  samples.value = getImageSamples(event.position.x, event.position.y);
});

onVTKEvent(view.interactor, 'onPointerLeave', () => {
  samples.value = undefined;
});

watch([currentImageID, sampleSet], () => {
  samples.value = undefined;
});
</script>

<template>
  <div v-if="samples !== undefined" class="probe-value-display">
    <div v-for="sample in samples.samples" :key="sample.id">
      <div>{{ sample.name }}: {{ sample.displayValue.join(', ') }}</div>
    </div>
    <div>Position: {{ `${samples.pos.map(Math.round).join(', ')}` }}</div>
  </div>
</template>

<style scoped>
.probe-value-display {
  position: absolute;
  bottom: 10px;
  right: 10px;
  background-color: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 12px;
  pointer-events: none;
}
</style>
