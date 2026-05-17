<script setup lang="ts">
import {
  computed,
  toRefs,
  watchEffect,
  watch,
  inject,
  shallowRef,
  nextTick,
} from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { LPSAxis } from '@/src/types/lps';
import { syncRefs } from '@vueuse/core';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { SlicingMode } from '@kitware/vtk.js/Rendering/Core/ImageMapper/Constants';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { getCineImage, isCineImage } from '@/src/core/cine/isCineImage';
import type DicomCineImage from '@/src/core/cine/DicomCineImage';
import { copyDecodedFrameToRgb } from '@/src/core/cine/frameCache';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
  axis: LPSAxis;
}

type CineRenderImage = {
  imageData: vtkImageData;
  dataArray: vtkDataArray;
  rgbBuffer: Uint8Array;
};

function createCineRenderImage(cineImage: DicomCineImage): CineRenderImage {
  const source = cineImage.getVtkImageData();
  if (!source) {
    throw new Error('Cine image has no canonical vtkImageData');
  }
  const extent = source.getExtent();
  const cols = extent[1] - extent[0] + 1;
  const rows = extent[3] - extent[2] + 1;

  const imageData = vtkImageData.newInstance();
  imageData.setExtent(extent);
  imageData.setSpacing(source.getSpacing());
  imageData.setOrigin(source.getOrigin());
  imageData.setDirection(source.getDirection());

  const rgbBuffer = new Uint8Array(cols * rows * 3);
  const dataArray = vtkDataArray.newInstance({
    numberOfComponents: 3,
    values: rgbBuffer,
  });
  dataArray.setRange({ min: 0, max: 255 }, 0);
  dataArray.setRange({ min: 0, max: 255 }, 1);
  dataArray.setRange({ min: 0, max: 255 }, 2);
  imageData.getPointData().setScalars(dataArray);

  return { imageData, dataArray, rgbBuffer };
}

const props = defineProps<Props>();
const { viewId: viewID, imageId: imageID, axis } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const { metadata: imageMetadata, imageData } = useImage(imageID);

// bind slice and window configs
const sliceConfig = useSliceConfig(viewID, imageID);
const wlConfig = useWindowingConfig(viewID, imageID);

const cine = computed(() => getCineImage(imageID.value));

// Per-view render buffer for cine so two views can show different frames
// without fighting over a single shared scalar buffer. Published to
// `cineRender` only after the first decoded pixels land.
const cineRender = shallowRef<CineRenderImage | null>(null);
let localCineRender: CineRenderImage | null = null;

watchEffect((onCleanup) => {
  const cineImage = cine.value;
  if (!cineImage) return;
  const local = createCineRenderImage(cineImage);
  localCineRender = local;
  cineRender.value = null;
  onCleanup(() => {
    if (localCineRender === local) {
      localCineRender = null;
    }
    if (cineRender.value === local) {
      cineRender.value = null;
    }
    // Let the mapper flush before we delete the vtkImageData it still holds.
    nextTick(() => {
      local.imageData.delete();
    });
  });
});

const mapperInput = computed(() => {
  if (cine.value) return cineRender.value?.imageData;
  return imageData.value;
});

// setup base image
const sliceRep = useSliceRepresentation(view, mapperInput);

// set slice ordering to be in the back
sliceRep.mapper.setResolveCoincidentTopologyToPolygonOffset();
sliceRep.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(1, 1);

// set slicing mode
watchEffect(() => {
  const { lpsOrientation } = imageMetadata.value;
  const ijkIndex = lpsOrientation[axis.value];
  const mode = [SlicingMode.I, SlicingMode.J, SlicingMode.K][ijkIndex];
  sliceRep.mapper.setSlicingMode(mode);
});

// Cine: the per-view image is a single 2D plane (mapper slice is always 0).
// The frame index drives the local-buffer watcher below instead.
const slice = vtkFieldRef(sliceRep.mapper, 'slice');
const renderSlice = computed(() => (cine.value ? 0 : sliceConfig.slice.value));
syncRefs(renderSlice, slice, { immediate: true });

// A token guards against stale decodes when scrubbing rapidly.
let frameToken = 0;
watch(
  [() => sliceConfig.slice.value, cine],
  ([frame, cineImage]) => {
    const target = localCineRender;
    if (!cineImage || !target) return;
    const myToken = ++frameToken;
    cineImage
      .getFrame(frame)
      .then((decoded) => {
        if (myToken !== frameToken) return;
        if (localCineRender !== target) return;
        if (!copyDecodedFrameToRgb(decoded, target.rgbBuffer)) return;
        target.dataArray.modified();
        target.imageData.modified();
        if (cineRender.value !== target) {
          cineRender.value = target;
        }
        view.requestRender();
      })
      .catch(() => {
        // getFrame already routed the error through reportError.
      });
  },
  { immediate: true }
);

// Cine pixels are 8-bit display-encoded — pin W/L to a full-byte pass-through
// and skip the bidirectional wlConfig sync, which would otherwise overwrite
// these with uninitialized defaults on first paint.
const colorLevel = vtkFieldRef(sliceRep.property, 'colorLevel');
const colorWindow = vtkFieldRef(sliceRep.property, 'colorWindow');

watch(
  () => isCineImage(imageID.value),
  (cineNow, _prev, onCleanup) => {
    if (cineNow) {
      colorWindow.value = 255;
      colorLevel.value = 127.5;
      return;
    }
    const stopLevel = syncRefs(wlConfig.level, colorLevel, { immediate: true });
    const stopWidth = syncRefs(wlConfig.width, colorWindow, {
      immediate: true,
    });
    onCleanup(() => {
      stopLevel();
      stopWidth();
    });
  },
  { immediate: true }
);

defineExpose(sliceRep);
</script>

<template>
  <slot></slot>
</template>
