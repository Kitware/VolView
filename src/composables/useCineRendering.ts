import {
  computed,
  MaybeRefOrGetter,
  nextTick,
  Ref,
  shallowRef,
  toValue,
  watch,
  watchEffect,
} from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { Maybe } from '@/src/types';
import { VtkViewApi } from '@/src/types/vtk-types';
import { getCineImage } from '@/src/core/cine/isCineImage';
import type DicomCineImage from '@/src/core/cine/DicomCineImage';
import { copyDecodedFrameToRgb } from '@/src/core/cine/frameCache';

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

export function useCineRendering(
  view: VtkViewApi,
  imageID: Ref<Maybe<string>>,
  imageData: Ref<Maybe<vtkImageData>>,
  frame: MaybeRefOrGetter<number | undefined>
) {
  const cine = computed(() => getCineImage(imageID.value));

  // Per-view render buffer so two views can show different frames without
  // fighting over a single shared scalar buffer. Published to `cineRender`
  // only after the first decoded pixels land.
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

  // A token guards against stale decodes when scrubbing rapidly.
  let frameToken = 0;
  watch(
    [() => toValue(frame) ?? 0, cine],
    ([frameIndex, cineImage]) => {
      const target = localCineRender;
      if (!cineImage || !target) return;
      const myToken = ++frameToken;
      cineImage
        .getFrame(frameIndex)
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

  const mapperInput = computed(() => {
    if (cine.value) return cineRender.value?.imageData;
    return imageData.value;
  });

  return { cine, mapperInput };
}
