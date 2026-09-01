import { beforeEach, describe, it, expect } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { applyPostStateConfig, config } from '@/src/io/import/configJson';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';

type LabelRecord = { labelName?: string; color?: string; fillColor?: string };

describe('config schema', () => {
  describe('shortcuts', () => {
    it('should accept partial shortcuts', () => {
      const result = config.safeParse({
        shortcuts: {
          polygon: 'Ctrl+p',
          rectangle: 'b',
        },
      });

      expect(result.success).to.be.true;
      expect(result.data?.shortcuts).to.deep.equal({
        polygon: 'Ctrl+p',
        rectangle: 'b',
      });
    });

    it('should reject invalid shortcut keys', () => {
      const result = config.safeParse({
        shortcuts: {
          invalidKey: 'Ctrl+x',
        },
      });

      expect(result.success).to.be.false;
    });

    it('should accept a list of keys for one action', () => {
      const result = config.safeParse({
        shortcuts: {
          deleteSelectedAnnotations: ['delete', 'backspace'],
        },
      });

      expect(result.success).to.be.true;
      expect(result.data?.shortcuts?.deleteSelectedAnnotations).to.deep.equal([
        'delete',
        'backspace',
      ]);
    });

    // + - and _ separate the keys of a chord, so a binding with one in key
    // position can never fire. It is dropped on apply, not rejected here,
    // so the rest of the config still loads.
    it.each(['ctrl+-', '-', 'shift+_'])(
      'should still parse a config carrying the unbindable %s',
      (binding) => {
        const result = config.safeParse({ shortcuts: { polygon: binding } });

        expect(result.success).to.be.true;
      }
    );

    it('should accept empty shortcuts', () => {
      const result = config.safeParse({
        shortcuts: {},
      });

      expect(result.success).to.be.true;
    });

    it('should accept config without shortcuts', () => {
      const result = config.safeParse({});

      expect(result.success).to.be.true;
    });
  });
});

describe('label config', () => {
  const seatAndView = (id: string) => {
    useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
      id,
    });
    useViewStore().setDataForAllViews(id);
  };

  const labelSummary = (store: { labels: Record<string, LabelRecord> }) =>
    Object.values(store.labels).map(({ labelName, color }) => ({
      labelName,
      color,
    }));

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // Config is applied before the primary selection, so there is no current
  // image when polygon and rectangle labels arrive.
  it('applies polygon labels configured before an image loads', async () => {
    applyPostStateConfig(
      config.parse({
        labels: { polygonLabels: { Tumor: { color: '#00ff00' } } },
      })
    );

    seatAndView('img-1');
    await nextTick();

    expect(labelSummary(usePolygonStore())).toEqual([
      { labelName: 'Tumor', color: '#00ff00' },
    ]);
  });

  it('applies rectangle labels configured before an image loads', async () => {
    applyPostStateConfig(
      config.parse({
        labels: {
          rectangleLabels: {
            Tumor: { color: '#00ff00', fillColor: '#00ff0033' },
          },
        },
      })
    );

    seatAndView('img-1');
    await nextTick();

    const store = useRectangleStore();
    expect(labelSummary(store)).toEqual([
      { labelName: 'Tumor', color: '#00ff00' },
    ]);
    expect(Object.values(store.labels).map((label) => label.fillColor)).toEqual(
      ['#00ff0033']
    );
  });

  it('falls back to defaultLabels for every tool kind', async () => {
    applyPostStateConfig(
      config.parse({
        labels: { defaultLabels: { Tumor: { color: '#00ff00' } } },
      })
    );

    seatAndView('img-1');
    await nextTick();

    expect(labelSummary(usePolygonStore())).toEqual([
      { labelName: 'Tumor', color: '#00ff00' },
    ]);
    expect(labelSummary(useRectangleStore())).toEqual([
      { labelName: 'Tumor', color: '#00ff00' },
    ]);
    expect(labelSummary(useRulerStore())).toEqual([
      { labelName: 'Tumor', color: '#00ff00' },
    ]);
  });

  it('applies config labels to an image that is already loaded', async () => {
    seatAndView('img-1');
    await nextTick();

    applyPostStateConfig(
      config.parse({
        labels: { polygonLabels: { Tumor: { color: '#00ff00' } } },
      })
    );

    expect(labelSummary(usePolygonStore())).toEqual([
      { labelName: 'Tumor', color: '#00ff00' },
    ]);
  });

  it('applies config labels to each image the user views', async () => {
    applyPostStateConfig(
      config.parse({
        labels: { polygonLabels: { Tumor: { color: '#00ff00' } } },
      })
    );

    seatAndView('img-1');
    await nextTick();
    seatAndView('img-2');
    await nextTick();

    expect(labelSummary(usePolygonStore())).toEqual([
      { labelName: 'Tumor', color: '#00ff00' },
    ]);
    expect(
      useSegmentationStore().getSegmentationForImage('img-1')?.order
    ).toHaveLength(1);
  });

  it('creates no segments when no labels are configured', async () => {
    applyPostStateConfig(config.parse({ labels: {} }));

    seatAndView('img-1');
    await nextTick();

    expect(usePolygonStore().labels).toEqual({});
    expect(
      useSegmentationStore().getSegmentationForImage('img-1')
    ).toBeUndefined();
  });
});
