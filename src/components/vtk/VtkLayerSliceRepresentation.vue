<script setup lang="ts">
import { toRefs, watchEffect, inject, computed, onScopeDispose } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { LPSAxis } from '@/src/types/lps';
import { SlicingMode } from '@kitware/vtk.js/Rendering/Core/ImageMapper/Constants';
import { VtkViewContext } from '@/src/components/vtk/context';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { syncRef } from '@vueuse/core';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import useLayerColoringStore from '@/src/store/view-configs/layers';
import { applyOpacityFunction } from '@/src/composables/useColoringEffect';
import { useImageCacheStore } from '@/src/store/image-cache';
import { isZeroWidthRange } from '@/src/utils/vtk-helpers';
import { nativeColorWindow } from '@/src/utils/nativeColorWindow';

type Props = {
  viewId: string;
  layerId: string;
  parentId: string;
  axis: LPSAxis;
};

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

const nativeColor = computed(
  () => componentCount.value === 3 || componentCount.value === 4
);

const sliceRep = useSliceRepresentation(view, imageData);
// Keep overlays in the same compositing pass as segments at every opacity.
sliceRep.actor.setForceTranslucent(true);

const ownedColorTransferFunction = vtkColorTransferFunction.newInstance();
const ownedOpacityFunction = vtkPiecewiseFunction.newInstance();
ownedColorTransferFunction.setVectorModeToMagnitude();
sliceRep.property.setIndependentComponents(false);
sliceRep.property.setRGBTransferFunction(0, ownedColorTransferFunction);
sliceRep.property.setScalarOpacity(0, ownedOpacityFunction);

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
    ? 'texture2D(colorTexture1, vec2(tcolor.b,0.5)).r, clamp(tcolor.a, 0.0, 1.0) * opacity);'
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

const colorPreset = computed(() =>
  nativeColor.value ? 'Grayscale' : coloringConfig.value.transferFunction.preset
);

const mappingRange = computed(() =>
  nativeColor.value
    ? [0, 1]
    : coloringConfig.value.transferFunction.mappingRange
);

watchEffect(() => {
  const preset = vtkColorMaps.getPresetByName(colorPreset.value);
  const [min, max] = mappingRange.value;
  // Rescale canonical points so narrow ranges do not lose their positions.
  if (preset) ownedColorTransferFunction.applyColorMap(preset);
  if (!isZeroWidthRange([min, max])) {
    ownedColorTransferFunction.setMappingRange(min, max);
  }
  view.requestRender();
});

const opacityFunction = computed(() => coloringConfig.value.opacityFunction);

watchEffect(() => {
  if (nativeColor.value) {
    // Stable identity tables let VTK reuse textures while opacity changes.
    ownedOpacityFunction.removeAllPoints();
    ownedOpacityFunction.addPoint(0, 1);
    ownedOpacityFunction.addPoint(1, 1);
  } else {
    applyOpacityFunction(opacityFunction.value, ownedOpacityFunction);
  }
  view.requestRender();
});

watchEffect(() => {
  sliceRep.property.setUseLookupTableScalarRange(scalarImage.value);
  if (nativeColor.value) {
    const { width, level } = nativeColorWindow(
      imageData.value?.getPointData().getScalars()?.getDataType()
    );
    sliceRep.property.setColorWindow(width);
    sliceRep.property.setColorLevel(level);
  } else if (!scalarImage.value) {
    const [min, max] = opacityFunction.value.mappingRange;
    sliceRep.property.setColorWindow(max - min);
    sliceRep.property.setColorLevel((min + max) / 2);
  }
  view.requestRender();
});

const opacity = computed(() => coloringConfig.value.blendConfig.opacity);
const visibility = computed(() => coloringConfig.value.blendConfig.visibility);

watchEffect(() => {
  sliceRep.property.setOpacity(opacity.value);
  sliceRep.actor.setVisibility(visibility.value);
  view.requestRender();
});

defineExpose(sliceRep);
</script>

<template>
  <slot></slot>
</template>
