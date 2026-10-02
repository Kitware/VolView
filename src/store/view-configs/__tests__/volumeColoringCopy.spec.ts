import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useImageStatsStore } from '@/src/store/image-stats';
import { useVolumeColoringStore } from '@/src/store/view-configs/volume-coloring';

function addImage(id: string) {
  const image = vtkImageData.newInstance();
  image.setDimensions([4, 1, 1]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      values: Float32Array.from([0, 10, 20, 100]),
      numberOfComponents: 1,
    })
  );
  useImageCacheStore().addVTKImageData(image, id, { id });
}

describe('Volume coloring copies', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('fits a copied view once the image stats arrive', async () => {
    addImage('image');
    const coloring = useVolumeColoringStore();
    coloring.setColorPreset('source', 'image', 'Grayscale');
    coloring.copyView('source', 'copy');

    useImageStatsStore().stats.image = {
      scalarMin: 0,
      scalarMax: 100,
      autoRangeValues: { LowContrast: [10, 20] },
    };
    await nextTick();

    ['source', 'copy'].forEach((viewID) =>
      expect(
        coloring.getConfig(viewID, 'image')?.transferFunction.mappingRange
      ).toEqual([10, 20])
    );
  });
});
