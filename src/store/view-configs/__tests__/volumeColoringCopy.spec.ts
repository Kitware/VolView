import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { useImageStatsStore } from '@/src/store/image-stats';
import { useVolumeColoringStore } from '@/src/store/view-configs/volume-coloring';
import { seatImage } from '@/src/segmentation/__tests__/segmentMaskFixtures';

describe('Volume coloring copies', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('fits a copied view once the image stats arrive', async () => {
    await seatImage('image', {
      dimensions: [4, 1, 1],
      values: Float32Array.from([0, 10, 20, 100]),
    });
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
