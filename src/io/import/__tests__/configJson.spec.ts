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
import type { SegmentTypeRegistry } from '@/src/store/tools/segmentTypeRegistry';
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

  const typeSummary = (registry: SegmentTypeRegistry) =>
    registry.typeList.value.map((type) => ({
      name: type.name,
      color: registry.appearanceOf(type.id).cssColor,
    }));

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // Config is applied before the primary selection, so there is no current
  // image when the types arrive.
  it('applies the shared types configured before an image loads', async () => {
    applyPostStateConfig(
      config.parse({ segmentTypes: { Tumor: { color: '#00ff00' } } })
    );

    seatAndView('img-1');
    await nextTick();

    expect(typeSummary(usePolygonStore().types)).toEqual([
      { name: 'Tumor', color: '#00ff00' },
    ]);
    expect(typeSummary(useRectangleStore().types)).toEqual([
      { name: 'Tumor', color: '#00ff00' },
    ]);
  });

  it('keeps the ruler registry to its own section', async () => {
    applyPostStateConfig(
      config.parse({
        segmentTypes: { Tumor: { color: '#00ff00' } },
        rulerTypes: { Long: { color: '#0000ff' } },
      })
    );

    seatAndView('img-1');
    await nextTick();

    expect(typeSummary(useRulerStore().types)).toEqual([
      { name: 'Long', color: '#0000ff' },
    ]);
    expect(typeSummary(usePolygonStore().types)).toEqual([
      { name: 'Tumor', color: '#00ff00' },
    ]);
    expect(useRulerStore().types.selectedTypeId.value).toBe(
      useRulerStore().types.findTypeByName('Long')?.id
    );
  });

  it('applies types to an image that is already loaded', async () => {
    seatAndView('img-1');
    await nextTick();

    applyPostStateConfig(
      config.parse({ segmentTypes: { Tumor: { color: '#00ff00' } } })
    );

    expect(typeSummary(usePolygonStore().types)).toEqual([
      { name: 'Tumor', color: '#00ff00' },
    ]);
  });

  it('offers the same types on each image the user views', async () => {
    applyPostStateConfig(
      config.parse({ segmentTypes: { Tumor: { color: '#00ff00' } } })
    );

    seatAndView('img-1');
    await nextTick();
    seatAndView('img-2');
    await nextTick();

    expect(typeSummary(usePolygonStore().types)).toEqual([
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
        segmentTypes: { Tumor: { color: '#00ff00', strokeWidth: 9 } },
      })
    );
    seatAndView('img-1');
    await nextTick();

    const polygons = usePolygonStore();
    const rectangles = useRectangleStore();
    const typeId = polygons.types.findTypeByName('Tumor')!.id;
    polygons.types.selectType(typeId);
    const segmentId = useSegmentationStore().resolveEditTarget('img-1');

    expect(useSegmentationStore().getSegment(segmentId).typeId).toBe(typeId);
    expect(polygons.types.appearanceOf(typeId)).toMatchObject({
      name: 'Tumor',
      cssColor: '#00ff00',
      strokeWidth: 9,
    });
    expect(rectangles.types.appearanceOf(typeId).name).toBe('Tumor');
  });

  it('creates nothing when no types are configured', async () => {
    applyPostStateConfig(config.parse({ segmentTypes: {} }));

    seatAndView('img-1');
    await nextTick();

    expect(usePolygonStore().types.typeList.value).toEqual([]);
    expect(
      useSegmentationStore().getSegmentationForImage('img-1')
    ).toBeUndefined();
  });
});
