<script setup lang="ts">
import { nativeColorWindow } from '@/src/utils/nativeColorWindow';
import { toRefs, watchEffect, inject, computed, onScopeDispose } from 'vue';
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
import useLayerColoringStore from '@/src/store/view-configs/layers';
import { applyColoring } from '@/src/composables/useColoringEffect';
import { useImageCacheStore } from '@/src/store/image-cache';

interface Props {
  viewId: string;
  layerId: string;
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
const imageCacheStore = useImageCacheStore();
const imageData = computed(() =>
  imageCacheStore.getVtkImageData(layerId.value)
);
const componentCount = computed(
  () =>
    imageData.value?.getPointData().getScalars()?.getNumberOfComponents() ?? 0
);
const scalarImage = computed(() => componentCount.value === 1);
const supportedImage = computed(() => [1, 3, 4].includes(componentCount.value));
const mapperInput = computed(() =>
  supportedImage.value ? imageData.value : undefined
);
const sliceRep = useSliceRepresentation(view, mapperInput);
// Keep overlays in the same compositing pass as segments at every opacity.
sliceRep.actor.setForceTranslucent(true);

const ownedColorTransferFunction = vtkColorTransferFunction.newInstance();
const ownedOpacityFunction = vtkPiecewiseFunction.newInstance();
onScopeDispose(() => {
  ownedColorTransferFunction.delete();
  ownedOpacityFunction.delete();
});

const backgroundFragment = computed(() => {
  const config = coloringConfig.value;
  if (!scalarImage.value || !(config?.transparentBackground ?? true)) return '';
  const [min, max] = config.transferFunction.mappingRange;
  const width = max - min;
  if (!Number.isFinite(width) || width <= 0) {
    return 'gl_FragData[0] = vec4(0.0);';
  }
  // Color coordinates track the display range without resampling preset opacity.
  return 'gl_FragData[0] = vec4(tcolor, scalarOpacity * opacity * clamp(10.0 * (intensity * cscale0 + cshift0), 0.0, 1.0));';
});

watchEffect(() => {
  const rgba = componentCount.value === 4;
  const originalValue = rgba
    ? 'texture2D(colorTexture1, vec2(tcolor.b,0.5)).r, tcolor.a);'
    : 'gl_FragData[0] = vec4(tcolor, scalarOpacity * opacity);';
  const replacementValue = rgba
    ? 'texture2D(colorTexture1, vec2(tcolor.b,0.5)).r, tcolor.a * opacity);'
    : backgroundFragment.value;
  sliceRep.mapper.set({
    viewSpecificProperties: {
      OpenGL: {
        ShaderReplacements: replacementValue
          ? [
              {
                shaderType: 'Fragment',
                originalValue,
                replaceFirst: false,
                replaceAll: false,
                replacementValue,
              },
            ]
          : [],
      },
    },
  });
  view.requestRender();
});

// set slice ordering to be in front of the segmentations
sliceRep.mapper.setResolveCoincidentTopologyToPolygonOffset();
sliceRep.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(-2, -2);

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

// apply layer coloring
const applyLayerColoring = () => {
  const config = coloringConfig.value;
  if (!config) return;

  sliceRep.property.setIndependentComponents(false);
  sliceRep.property.setUseLookupTableScalarRange(scalarImage.value);
  sliceRep.property.setRGBTransferFunction(
    0,
    scalarImage.value ? ownedColorTransferFunction : null
  );
  sliceRep.property.setScalarOpacity(
    0,
    scalarImage.value ? ownedOpacityFunction : null
  );
  if (scalarImage.value) {
    applyColoring({
      props: {
        colorFunction: config.transferFunction,
        opacityFunction: config.opacityFunction,
      },
      cfun: ownedColorTransferFunction,
      ofun: ownedOpacityFunction,
    });
  } else {
    const { width, level } = nativeColorWindow(
      mapperInput.value?.getPointData().getScalars()?.getDataType()
    );
    sliceRep.property.setColorWindow(width);
    sliceRep.property.setColorLevel(level);
  }
  sliceRep.property.setOpacity(config.blendConfig.opacity);
  sliceRep.actor.setVisibility(
    supportedImage.value && config.blendConfig.visibility
  );
  view.requestRender();
};

watchEffect(applyLayerColoring);

defineExpose(sliceRep);
</script>

<template>
  <slot></slot>
</template>
