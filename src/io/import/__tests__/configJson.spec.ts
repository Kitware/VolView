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
import type { SegmentRegistry } from '@/src/store/tools/segmentRegistry';
import { useViewStore } from '@/src/store/views';

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

describe('segment type config', () => {
  const seatAndView = (id: string) => {
    useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
      id,
    });
    useViewStore().setDataForAllViews(id);
  };

  const typeSummary = (registry: SegmentRegistry) =>
    registry.segmentList.value.map((type) => ({
      name: type.name,
      color: registry.appearanceOf(type.id).cssColor,
    }));

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // Config is applied before the primary selection, so there is no current
  // image when the segments arrive.
  it('applies the shared segments configured before an image loads', async () => {
    applyPostStateConfig(
      config.parse({ segments: { Tumor: { color: '#00ff00' } } })
    );

    seatAndView('img-1');
    await nextTick();

    expect(typeSummary(usePolygonStore().segments)).toEqual([
      { name: 'Tumor', color: '#00ff00' },
    ]);
    expect(typeSummary(useRectangleStore().segments)).toEqual([
      { name: 'Tumor', color: '#00ff00' },
    ]);
  });

  it('keeps the ruler registry to its own section', async () => {
    applyPostStateConfig(
      config.parse({
        segments: { Tumor: { color: '#00ff00' } },
        rulerSegments: { Long: { color: '#0000ff' } },
      })
    );

    seatAndView('img-1');
    await nextTick();

    expect(typeSummary(useRulerStore().segments)).toEqual([
      { name: 'Long', color: '#0000ff' },
    ]);
    expect(typeSummary(usePolygonStore().segments)).toEqual([
      { name: 'Tumor', color: '#00ff00' },
    ]);
    expect(useRulerStore().segments.selectedSegmentId.value).toBe(
      useRulerStore().segments.findSegmentByName('Long')?.id
    );
  });

  it('applies segments to an image that is already loaded', async () => {
    seatAndView('img-1');
    await nextTick();

    applyPostStateConfig(
      config.parse({ segments: { Tumor: { color: '#00ff00' } } })
    );

    expect(typeSummary(usePolygonStore().segments)).toEqual([
      { name: 'Tumor', color: '#00ff00' },
    ]);
  });

  it('offers the same segments on each image the user views', async () => {
    applyPostStateConfig(
      config.parse({ segments: { Tumor: { color: '#00ff00' } } })
    );

    seatAndView('img-1');
    await nextTick();
    seatAndView('img-2');
    await nextTick();

    expect(typeSummary(usePolygonStore().segments)).toEqual([
      { name: 'Tumor', color: '#00ff00' },
    ]);
    // Offered, not minted: a configured type gets a mask on the first edit.
    expect(
      useSegmentationStore().getSegmentationForImage('img-1')
    ).toBeUndefined();
  });

  // The type carries the appearance, so one configured entry reaches paint,
  // rectangles and polygons alike.
  it('keeps the configured appearance on the type an edit lands in', async () => {
    applyPostStateConfig(
      config.parse({
        segments: { Tumor: { color: '#00ff00', strokeWidth: 9 } },
      })
    );
    seatAndView('img-1');
    await nextTick();

    const polygons = usePolygonStore();
    const rectangles = useRectangleStore();
    const segmentId = polygons.segments.findSegmentByName('Tumor')!.id;
    polygons.segments.selectSegment(segmentId);
    const maskId = useSegmentationStore().resolveEditTarget('img-1');

    expect(useSegmentationStore().getMask(maskId).segmentId).toBe(segmentId);
    expect(polygons.segments.appearanceOf(segmentId)).toMatchObject({
      name: 'Tumor',
      cssColor: '#00ff00',
      strokeWidth: 9,
    });
    expect(rectangles.segments.appearanceOf(segmentId).name).toBe('Tumor');
  });

  it('creates nothing when no segments are configured', async () => {
    applyPostStateConfig(config.parse({ segments: {} }));

    seatAndView('img-1');
    await nextTick();

    expect(usePolygonStore().segments.segmentList.value).toEqual([]);
    expect(
      useSegmentationStore().getSegmentationForImage('img-1')
    ).toBeUndefined();
  });
});
