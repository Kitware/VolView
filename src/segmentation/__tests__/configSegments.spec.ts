import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  maskOn,
  boundMasks,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';
import { applyPostStateConfig, config } from '@/src/io/import/configJson';
import { cssColorToRGBA } from '@/src/segmentation/color';
import { resolveSegmentAppearance } from '@/src/segmentation/segment';

// ---------------------------------------------------------------------------
// Configured segments are declared once for a session, before any image loads.
// Configuring one creates nothing: no mask, no geometry, no image. A key keeps
// its type id across config changes, and dropping a key only removes the type
// when nothing references it.
// ---------------------------------------------------------------------------

const store = () => useSegmentationStore();
const segments = () => useSegmentStore().segments;

const seatImage = (id: string) =>
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
    id,
  });

const viewImage = async (id: string) => {
  useViewStore().setDataForAllViews(id);
  await nextTick();
};

const seatAndView = async (id: string) => {
  seatImage(id);
  await viewImage(id);
};

const applyConfig = (raw: unknown) => applyPostStateConfig(config.parse(raw));

const typeNames = () => segments().segmentList.value.map((type) => type.name);

const segmentIdNamed = (name: string) => {
  const type = segments().findSegmentByName(name);
  if (!type) throw new Error(`No type named "${name}"`);
  return type.id;
};

const recordsOf = (imageId: string) =>
  store().getSegmentationForImage(imageId)?.order ?? [];

const TWO_TYPES = {
  segments: {
    Tumor: { color: '#00ff00' },
    Node: { color: 'red' },
  },
};

describe('a configured type creates nothing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('touches no image when the config is applied', async () => {
    await seatAndView('img-1');

    applyConfig(TWO_TYPES);

    expect(typeNames()).toEqual(['Tumor', 'Node']);
    expect(store().getSegmentationForImage('img-1')).toBeFalsy();
    expect(boundMasks()).toEqual([]);
  });

  it('offers the same segments on every image the user views', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    await seatAndView('img-2');

    expect(typeNames()).toEqual(['Tumor', 'Node']);
    expect(recordsOf('img-1')).toEqual([]);
    expect(recordsOf('img-2')).toEqual([]);
  });

  it('takes the configured color and appearance', () => {
    applyConfig({
      segments: {
        Tumor: { color: '#00ff00', fillOpacity: 0.4, strokeWidth: 3 },
      },
    });

    const appearance = segments().appearanceOf(segmentIdNamed('Tumor'));
    expect(appearance.color).toEqual(cssColorToRGBA('#00ff00'));
    expect(appearance.fillOpacity).toBe(0.4);
    expect(appearance.strokeWidth).toBe(3);
    // Unstated fields resolve to the app default rather than being stored.
    expect(
      segments().getSegment(segmentIdNamed('Tumor'))?.outlineOpacity
    ).toBeUndefined();
  });

  it('offers a selection without allocating for it', () => {
    applyConfig(TWO_TYPES);

    expect(segments().selectedSegmentId.value).toBe(segmentIdNamed('Tumor'));
    expect(store().segmentations).toEqual({});
  });

  it('lands the first edit in the selected configured type', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    segments().selectSegment(segmentIdNamed('Node'));

    const target = store().resolveEditTarget('img-1');

    expect(store().getMask(target).segmentId).toBe(segmentIdNamed('Node'));
    expect(typeNames()).toEqual(['Tumor', 'Node']);
  });

  it('reaches every annotation tool, rulers included', () => {
    applyConfig(TWO_TYPES);

    expect(
      usePolygonStore().segments.segmentList.value.map((t) => t.name)
    ).toEqual(['Tumor', 'Node']);
    expect(
      useRectangleStore().segments.segmentList.value.map((t) => t.name)
    ).toEqual(['Tumor', 'Node']);
    expect(
      useRulerStore().segments.segmentList.value.map((t) => t.name)
    ).toEqual(['Tumor', 'Node']);
  });
});

describe('a second config replaces the first', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps the id of a key both configs state', () => {
    applyConfig(TWO_TYPES);
    const before = segmentIdNamed('Tumor');

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(segmentIdNamed('Tumor')).toBe(before);
    expect(segments().appearanceOf(before).color).toEqual(
      cssColorToRGBA('blue')
    );
  });

  it('removes omitted appearance overrides without changing mask or shape references', async () => {
    applyConfig({
      segments: {
        Tumor: {
          color: 'red',
          fillOpacity: 0,
          outlineOpacity: 0,
          strokeWidth: 9,
        },
      },
    });
    await seatAndView('img-1');
    const id = segmentIdNamed('Tumor');
    const mask = maskOn('img-1', id);
    const toolId = usePolygonStore().addTool({
      imageID: 'img-1',
      segmentId: id,
    });
    segments().updateSegment(id, { visible: false, locked: true });

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(segments().appearanceOf(id)).toMatchObject({
      color: cssColorToRGBA('blue'),
      fillOpacity: 1,
      outlineOpacity: 1,
      strokeWidth: resolveSegmentAppearance(undefined).strokeWidth,
      visible: false,
      locked: true,
    });
    expect(store().getMask(mask.id).segmentId).toBe(id);
    expect(usePolygonStore().toolByID[toolId].segmentId).toBe(id);
    expect(segmentIdNamed('Tumor')).toBe(id);
  });

  it('returns to its automatic color when a retained config omits color', () => {
    applyConfig({ segments: { First: {}, Second: {} } });
    const id = segmentIdNamed('Second');
    const automaticColor = segments().appearanceOf(id).color;
    applyConfig({ segments: { First: {}, Second: { color: 'blue' } } });

    applyConfig({ segments: { First: {}, Second: {} } });

    expect(segments().appearanceOf(id).color).toEqual(automaticColor);
    expect(segmentIdNamed('Second')).toBe(id);
  });

  it('keeps the last configured appearance when a referenced key is dropped', async () => {
    applyConfig({
      segments: {
        Tumor: {
          color: 'red',
          fillOpacity: 0.3,
          outlineOpacity: 0.4,
          strokeWidth: 9,
        },
      },
    });
    await seatAndView('img-1');
    const id = segmentIdNamed('Tumor');
    const mask = maskOn('img-1', id);
    const before = segments().appearanceOf(id);

    applyConfig({ segments: {} });

    expect(segments().appearanceOf(id)).toEqual(before);
    expect(store().getMask(mask.id).segmentId).toBe(id);
  });

  it('drops an unreferenced type the second config leaves out', () => {
    applyConfig(TWO_TYPES);

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(typeNames()).toEqual(['Tumor']);
  });

  it('keeps a dropped type that a mask still references', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    const node = segmentIdNamed('Node');
    const record = maskOn('img-1', node);

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(segments().getSegment(node)?.name).toBe('Node');
    expect(recordsOf('img-1')).toEqual([record.id]);
  });

  it('keeps a dropped type that a shape still references', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    const node = segmentIdNamed('Node');
    const toolId = usePolygonStore().addTool({
      imageID: 'img-1',
      segmentId: node,
    });

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(segments().getSegment(node)?.name).toBe('Node');
    expect(usePolygonStore().toolByID[toolId].segmentId).toBe(node);
  });

  it('clears the whole contribution on an empty record', () => {
    applyConfig(TWO_TYPES);

    applyConfig({ segments: {} });

    expect(typeNames()).toEqual([]);
  });

  it('clears the contribution on an explicit null', () => {
    applyConfig(TWO_TYPES);

    applyConfig({ segments: null });

    expect(typeNames()).toEqual([]);
  });

  it('leaves the registry alone when the section is omitted', () => {
    applyConfig(TWO_TYPES);

    applyConfig({ layouts: {} });

    expect(typeNames()).toEqual(['Tumor', 'Node']);
  });

  it('leaves a type the user made alone', () => {
    applyConfig(TWO_TYPES);
    const own = segments().addSegment({ name: 'Mine' });

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(segments().getSegment(own)?.name).toBe('Mine');
    expect(typeNames()).toEqual(['Tumor', 'Mine']);
  });
});

describe('config applies after a restore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('overlays a restored type of the same name rather than adding one', () => {
    // Restore seats the type first; the config then states its appearance.
    const restored = segments().mintSegment({
      name: 'Tumor',
      color: [1, 2, 3, 255],
    });

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(typeNames()).toEqual(['Tumor']);
    expect(segments().appearanceOf(restored).color).toEqual(
      cssColorToRGBA('blue')
    );
  });

  it('restores session appearance when replacement removes a config override', () => {
    const id = segments().mintSegment({
      name: 'Tumor',
      color: [1, 2, 3, 255],
      fillOpacity: 0.6,
      outlineOpacity: 0.7,
      strokeWidth: 4,
      visible: false,
      locked: true,
    });
    const original = segments().appearanceOf(id);
    applyConfig({
      segments: { Tumor: { color: 'blue', fillOpacity: 0, strokeWidth: 9 } },
    });
    expect(segments().appearanceOf(id).outlineOpacity).toBe(0.7);

    applyConfig({ segments: { Tumor: {} } });

    expect(segments().appearanceOf(id)).toEqual(original);
  });

  it('keeps a restored type the config does not name', () => {
    const restored = segments().mintSegment({ name: 'Restored' });

    applyConfig(TWO_TYPES);

    expect(segments().getSegment(restored)?.name).toBe('Restored');
    expect(typeNames()).toEqual(['Restored', 'Tumor', 'Node']);
  });

  it('keeps a shape pointing at the type the config took over', () => {
    const restored = segments().mintSegment({ name: 'Tumor' });
    const toolId = useRectangleStore().addTool({
      imageID: 'img-1',
      segmentId: restored,
    });

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(useRectangleStore().toolByID[toolId].segmentId).toBe(restored);
    expect(useRectangleStore().appearanceOfTool(toolId).cssColor).toBe(
      '#0000ff'
    );
  });
});
