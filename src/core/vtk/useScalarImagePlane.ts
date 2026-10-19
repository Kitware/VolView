import { computed, onScopeDispose, unref, watch, type MaybeRef } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { metadataFromVtkImageData } from '@/src/core/progressiveImage';
import { prepareScalarPlane, type ScalarPlaneInput } from './scalarPlane';

/** The mounted view owns this render image; source storage is never transferred. */
export function useScalarImagePlane(input: MaybeRef<ScalarPlaneInput | null>) {
  const image = vtkImageData.newInstance();
  const scalars = vtkDataArray.newInstance({
    numberOfComponents: 1,
    values: new Float32Array(1),
  });
  image.getPointData().setScalars(scalars);
  const prepared = computed(() => {
    const current = unref(input);
    return current ? prepareScalarPlane(current.values) : null;
  });
  watch(
    [() => unref(input), prepared],
    ([current, data]) => {
      if (!current || !data) return;
      const [sx, sy] = current.spacing;
      image.setDimensions(current.width, current.height, 1);
      image.setSpacing([sx, sy, 1]);
      image.setOrigin([sx / 2, sy / 2, 0]);
      scalars.setData(data.scalars, 1);
      image.modified();
    },
    { immediate: true, flush: 'sync' }
  );
  onScopeDispose(() => {
    image.delete();
    scalars.delete();
  });
  return {
    imageData: computed(() => (unref(input) ? image : null)),
    metadata: computed(() =>
      unref(input) ? { name: '', ...metadataFromVtkImageData(image) } : null
    ),
    offset: computed(() => prepared.value?.offset ?? 0),
  };
}
