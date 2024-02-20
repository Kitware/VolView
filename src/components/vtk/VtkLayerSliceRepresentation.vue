<script setup lang="ts">
import { toRefs, watchEffect, inject, computed } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { LPSAxis } from '@/src/types/lps';
import { SlicingMode } from '@kitware/vtk.js/Rendering/Core/ImageMapper/Constants';
import { VtkViewContext } from '@/src/components/vtk/context';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { syncRef } from '@vueuse/core';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { LayerID, useLayersStore } from '@/src/store/datasets-layers';
import useLayerColoringStore from '@/src/store/view-configs/layers';
import { useLayerConfigInitializer } from '@/src/composables/useLayerConfigInitializer';
import { applyColoring } from '@/src/composables/useColoringEffectNew';

interface Props {
  viewId: string;
  layerId: LayerID;
  parentId: string;
  axis: LPSAxis;
}

const props = defineProps<Props>();
const { viewId, layerId, parentId, axis } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const coloringStore = useLayerColoringStore();
const coloringConfig = computed(() =>
  coloringStore.getConfig(viewId.value, layerId.value)
);

// setup slice rep
const layerStore = useLayersStore();
const imageData = computed(() => layerStore.layerImages[layerId.value]);
const sliceRep = useSliceRepresentation(view, imageData);

sliceRep.property.setRGBTransferFunction(
  0,
  vtkColorTransferFunction.newInstance()
);
sliceRep.property.setScalarOpacity(0, vtkPiecewiseFunction.newInstance());
sliceRep.property.setUseLookupTableScalarRange(false);

// set slice ordering to be in front of the segmentations
sliceRep.mapper.setResolveCoincidentTopologyToPolygonOffset();
sliceRep.mapper.setResolveCoincidentTopologyPolygonOffsetParameters(-4, -4);

// set slicing mode
const { metadata: parentMetadata } = useImage(parentId);

watchEffect(() => {
  const { lpsOrientation } = parentMetadata.value;
  const ijkIndex = lpsOrientation[axis.value];
  const mode = [SlicingMode.I, SlicingMode.J, SlicingMode.K][ijkIndex];
  sliceRep.mapper.setSlicingMode(mode);
});

// sync slicing
const slice = vtkFieldRef(sliceRep.mapper, 'slice');
const { slice: storedSlice } = useSliceConfig(viewId, parentId);
syncRef(storedSlice, slice, { immediate: true });

// initialize layer coloring
useLayerConfigInitializer(viewId, layerId);

// apply layer coloring
const applyLayerColoring = () => {
  const config = coloringConfig.value;
  if (!config) return;

  const cfun = sliceRep.property.getRGBTransferFunction(0);
  const ofun = sliceRep.property.getScalarOpacity(0);

  applyColoring({
    props: {
      colorFunction: config.transferFunction,
      opacityFunction: config.opacityFunction,
    },
    cfun,
    ofun,
  });

  const { opacityFunction } = config;

  const { mappingRange } = opacityFunction;
  const width = mappingRange[1] - mappingRange[0];
  const center = (mappingRange[1] + mappingRange[0]) / 2;

  sliceRep.property.setColorWindow(width);
  sliceRep.property.setColorLevel(center);
  sliceRep.property.setOpacity(config.blendConfig.opacity);
};

watchEffect(applyLayerColoring);
</script>

<template>
  <slot></slot>
</template>
