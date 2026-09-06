import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { recordFor } from '@/src/store/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentTypeStore } from '@/src/store/segmentTypes';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';
import { applyPostStateConfig, config } from '@/src/io/import/configJson';
import { cssColorToRGBA } from '@/src/types/segmentation';

// ---------------------------------------------------------------------------
// Configured types are declared once for a session, before any image loads.
// Configuring one creates nothing: no mask, no geometry, no image. A key keeps
// its type id across config changes, and dropping a key only removes the type
// when nothing references it.
// ---------------------------------------------------------------------------

const store = () => useSegmentationStore();
const types = () => useSegmentTypeStore().types;

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

const typeNames = () => types().typeList.value.map((type) => type.name);

const typeIdNamed = (name: string) => {
  const type = types().findTypeByName(name);
  if (!type) throw new Error(`No type named "${name}"`);
  return type.id;
};

const recordsOf = (imageId: string) =>
  store().getSegmentationForImage(imageId)?.order ?? [];

const TWO_TYPES = {
  segmentTypes: {
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
    expect(store().artifactMeta).toEqual({});
  });

  it('offers the same types on every image the user views', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    await seatAndView('img-2');

    expect(typeNames()).toEqual(['Tumor', 'Node']);
    expect(recordsOf('img-1')).toEqual([]);
    expect(recordsOf('img-2')).toEqual([]);
  });

  it('takes the configured color and appearance', () => {
    applyConfig({
      segmentTypes: {
        Tumor: { color: '#00ff00', fillOpacity: 0.4, strokeWidth: 3 },
      },
    });

    const appearance = types().appearanceOf(typeIdNamed('Tumor'));
    expect(appearance.color).toEqual(cssColorToRGBA('#00ff00'));
    expect(appearance.fillOpacity).toBe(0.4);
    expect(appearance.strokeWidth).toBe(3);
    // Unstated fields resolve to the app default rather than being stored.
    expect(
      types().getType(typeIdNamed('Tumor'))?.outlineOpacity
    ).toBeUndefined();
  });

  it('offers a selection without allocating for it', () => {
    applyConfig(TWO_TYPES);

    expect(types().selectedTypeId.value).toBe(typeIdNamed('Tumor'));
    expect(store().segmentations).toEqual({});
  });

  it('lands the first edit in the selected configured type', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    types().selectType(typeIdNamed('Node'));

    const target = store().resolveEditTarget('img-1');

    expect(store().getSegment(target).typeId).toBe(typeIdNamed('Node'));
    expect(typeNames()).toEqual(['Tumor', 'Node']);
  });

  it('reaches every delineation tool and leaves rulers alone', () => {
    applyConfig({ ...TWO_TYPES, rulerTypes: { Long: { color: 'blue' } } });

    expect(usePolygonStore().types.typeList.value.map((t) => t.name)).toEqual([
      'Tumor',
      'Node',
    ]);
    expect(useRectangleStore().types.typeList.value.map((t) => t.name)).toEqual(
      ['Tumor', 'Node']
    );
    expect(useRulerStore().types.typeList.value.map((t) => t.name)).toEqual([
      'Long',
    ]);
  });
});

describe('a second config replaces the first', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps the id of a key both configs state', () => {
    applyConfig(TWO_TYPES);
    const before = typeIdNamed('Tumor');

    applyConfig({ segmentTypes: { Tumor: { color: 'blue' } } });

    expect(typeIdNamed('Tumor')).toBe(before);
    expect(types().appearanceOf(before).color).toEqual(cssColorToRGBA('blue'));
  });

  it('drops an unreferenced type the second config leaves out', () => {
    applyConfig(TWO_TYPES);

    applyConfig({ segmentTypes: { Tumor: { color: 'blue' } } });

    expect(typeNames()).toEqual(['Tumor']);
  });

  it('keeps a dropped type that a mask still references', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    const node = typeIdNamed('Node');
    const record = recordFor('img-1', node);

    applyConfig({ segmentTypes: { Tumor: { color: 'blue' } } });

    expect(types().getType(node)?.name).toBe('Node');
    expect(recordsOf('img-1')).toEqual([record.id]);
  });

  it('keeps a dropped type that a shape still references', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    const node = typeIdNamed('Node');
    const toolId = usePolygonStore().addTool({
      imageID: 'img-1',
      typeId: node,
    });

    applyConfig({ segmentTypes: { Tumor: { color: 'blue' } } });

    expect(types().getType(node)?.name).toBe('Node');
    expect(usePolygonStore().toolByID[toolId].typeId).toBe(node);
  });

  it('clears the whole contribution on an empty record', () => {
    applyConfig(TWO_TYPES);

    applyConfig({ segmentTypes: {} });

    expect(typeNames()).toEqual([]);
  });

  it('clears the contribution on an explicit null', () => {
    applyConfig(TWO_TYPES);

    applyConfig({ segmentTypes: null });

    expect(typeNames()).toEqual([]);
  });

  it('leaves the registry alone when the section is omitted', () => {
    applyConfig(TWO_TYPES);

    applyConfig({ rulerTypes: { Long: { color: 'blue' } } });

    expect(typeNames()).toEqual(['Tumor', 'Node']);
  });

  it('leaves a type the user made alone', () => {
    applyConfig(TWO_TYPES);
    const own = types().addType({ name: 'Mine' });

    applyConfig({ segmentTypes: { Tumor: { color: 'blue' } } });

    expect(types().getType(own)?.name).toBe('Mine');
    expect(typeNames()).toEqual(['Tumor', 'Mine']);
  });
});

describe('config applies after a restore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('overlays a restored type of the same name rather than adding one', () => {
    // Restore seats the type first; the config then states its appearance.
    const restored = types().mintType({ name: 'Tumor', color: [1, 2, 3, 255] });

    applyConfig({ segmentTypes: { Tumor: { color: 'blue' } } });

    expect(typeNames()).toEqual(['Tumor']);
    expect(types().appearanceOf(restored).color).toEqual(
      cssColorToRGBA('blue')
    );
  });

  it('keeps a restored type the config does not name', () => {
    const restored = types().mintType({ name: 'Restored' });

    applyConfig(TWO_TYPES);

    expect(types().getType(restored)?.name).toBe('Restored');
    expect(typeNames()).toEqual(['Restored', 'Tumor', 'Node']);
  });

  it('keeps a shape pointing at the type the config took over', () => {
    const restored = types().mintType({ name: 'Tumor' });
    const toolId = useRectangleStore().addTool({
      imageID: 'img-1',
      typeId: restored,
    });

    applyConfig({ segmentTypes: { Tumor: { color: 'blue' } } });

    expect(useRectangleStore().toolByID[toolId].typeId).toBe(restored);
    expect(useRectangleStore().appearanceOfTool(toolId).cssColor).toBe(
      '#0000ff'
    );
  });
});
