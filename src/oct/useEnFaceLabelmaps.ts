import {
  computed,
  onScopeDispose,
  ref,
  unref,
  watch,
  type MaybeRef,
} from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import {
  createInvalidPixelMask,
  createThinRegionMask,
} from './projectionMasks';
import type { ProjectionResult } from './types';

function useMaskImage(
  plane: MaybeRef<vtkImageData | null>,
  values: MaybeRef<Uint8Array | null>
) {
  const image = vtkImageData.newInstance();
  const scalars = vtkDataArray.newInstance({
    numberOfComponents: 1,
    values: new Uint8Array(1),
  });
  image.getPointData().setScalars(scalars);
  const revision = ref(0);
  onVTKEvent(plane, 'onModified', () => {
    revision.value += 1;
  });
  watch(
    [() => unref(plane), revision, () => unref(values)],
    ([source, , pixels]) => {
      if (!source || !pixels) return;
      image.setDimensions(source.getDimensions());
      image.setSpacing(source.getSpacing());
      image.setOrigin(source.getOrigin());
      image.setDirection(source.getDirection());
      scalars.setData(pixels, 1);
      image.modified();
    },
    { immediate: true }
  );
  onScopeDispose(() => {
    image.delete();
    scalars.delete();
  });
  return computed(() => (unref(plane) && unref(values) ? image : null));
}

/** These render-owned masks borrow only the accepted scalar plane's geometry. */
export function useEnFaceLabelmaps(
  plane: MaybeRef<vtkImageData | null>,
  projection: MaybeRef<ProjectionResult | null>,
  threshold: MaybeRef<number>
) {
  const thinPixels = computed(() => {
    const result = unref(projection);
    return result?.thicknessMicrons
      ? createThinRegionMask(result, unref(threshold))
      : null;
  });
  const invalidPixels = computed(() => {
    const result = unref(projection);
    return result ? createInvalidPixelMask(result) : null;
  });
  return {
    thinRegions: useMaskImage(plane, thinPixels),
    invalidPixels: useMaskImage(plane, invalidPixels),
  };
}
