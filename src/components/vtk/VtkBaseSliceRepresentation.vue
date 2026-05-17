<script setup lang="ts">
import { computed, toRefs, watchEffect, watch, inject, shallowRef } from 'vue';
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
import type { DecodedFrame } from '@/src/core/cine/frameCache';

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
  const spacing = source.getSpacing();
  const origin = source.getOrigin();
  const direction = source.getDirection();
  const cols = extent[1] - extent[0] + 1;
  const rows = extent[3] - extent[2] + 1;

  const imageData = vtkImageData.newInstance();
  imageData.setExtent(extent);
  imageData.setSpacing(spacing);
  imageData.setOrigin(origin);
  imageData.setDirection(direction);

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

function copyDecodedFrameToRgb(
  frame: DecodedFrame,
  target: CineRenderImage
): boolean {
  const { rgba } = frame;
  const out = target.rgbBuffer;
  const expectedPixels = out.length / 3;
  if (rgba.length !== expectedPixels * 4) return false;
  for (let i = 0; i < expectedPixels; i++) {
    const src = i * 4;
    const dst = i * 3;
    out[dst] = rgba[src];
    out[dst + 1] = rgba[src + 1];
    out[dst + 2] = rgba[src + 2];
  }
  return true;
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

// Per-view render buffer for cine. Built from the canonical cine image's
// geometry; the mapper renders from this local image so two views can show
// different frames without overwriting each other's pixels.
const cineRender = shallowRef<CineRenderImage | null>(null);

watchEffect((onCleanup) => {
  const cineImage = cine.value;
  if (!cineImage) return;
  const local = createCineRenderImage(cineImage);
  cineRender.value = local;
  onCleanup(() => {
    local.imageData.delete();
    if (cineRender.value === local) {
      cineRender.value = null;
    }
  });
});

// Mapper input — when cine, use the per-view buffer (or null until decoded
// so we don't briefly show frame 0 from the canonical image).
const mapperInput = computed(() => {
  if (cine.value) return cineRender.value?.imageData ?? null;
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

// sync slicing
// For cine, the semantic slice (frame index) is decoupled from the VTK
// render slice — the per-view cine image is a single 2D plane, so the mapper
// always renders slice 0. The frame index drives the local-buffer watcher
// below.
const slice = vtkFieldRef(sliceRep.mapper, 'slice');
const renderSlice = computed(() => (cine.value ? 0 : sliceConfig.slice.value));
syncRefs(renderSlice, slice, { immediate: true });

// Decode the requested frame and copy it into the per-view buffer. A local
// token guards against stale async work after rapid scrubs or cine-image
// changes.
let frameToken = 0;
watch(
  [() => sliceConfig.slice.value, cine, cineRender],
  ([frame, cineImage, target]) => {
    if (!cineImage || !target) return;
    const myToken = ++frameToken;
    cineImage
      .getFrame(frame)
      .then((decoded) => {
        if (myToken !== frameToken) return;
        if (cineRender.value !== target) return;
        if (!copyDecodedFrameToRgb(decoded, target)) return;
        target.dataArray.modified();
        target.imageData.modified();
        view.requestRender();
      })
      .catch(() => {
        // getFrame already routed the error through reportError.
      });
  },
  { immediate: true }
);

// sync windowing
// For cine, the pixels are 8-bit display-encoded — the volume W/L pipeline is
// meaningless. Pin the property to a full-byte pass-through and skip the
// bidirectional wlConfig sync, which otherwise overwrites these values with
// the uninitialized defaults (width=1, level=2^32-1) on first paint and again
// any time wlConfig changes for an adjacent volume in the same session.
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
