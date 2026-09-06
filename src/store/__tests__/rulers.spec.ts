import { describe, it, beforeEach, expect } from 'vitest';

import { setActivePinia, createPinia } from 'pinia';
import { mintType } from '@/src/store/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';
import {
  RULER_TYPE_DEFAULTS,
  STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
  TOOL_COLORS,
} from '@/src/config';
import { cssColorToRGBA, rgbaToCssColor } from '@/src/types/segmentation';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useRulerStore } from '@/src/store/tools/rulers';
import { Ruler } from '@/src/types/ruler';
import { RequiredWithPartial } from '@/src/types';
import { ToolID } from '@/src/types/annotation-tool';

function createRuler(): RequiredWithPartial<
  Ruler,
  'id' | 'typeId' | 'hidden' | 'metadata' | 'frame' | 'source'
> {
  return {
    firstPoint: [1, 1, 1],
    secondPoint: [2, 2, 2],
    imageID: '4',
    name: 'Ruler',
    frameOfReference: {
      planeNormal: [1, 0, 0],
      planeOrigin: [0, 0, 0],
    },
    slice: 23,
    placing: false,
  };
}

describe('Ruler store', () => {
  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
  });

  it('should add new rulers', () => {
    const store = useRulerStore();
    const id = store.addRuler(createRuler());
    expect(store.rulerByID).to.have.key(id);
  });

  it('should update rulers, if they exist', () => {
    const store = useRulerStore();
    const id = store.addRuler(createRuler());

    store.updateRuler(id, {
      imageID: '123',
    });
    expect(store.rulerByID[id]).to.have.property('imageID', '123');

    store.updateRuler('fakeID' as ToolID, {
      slice: 88,
    });
    expect(store.rulerByID).to.not.have.property('fakeID');
  });

  it('should have a rulers getter', () => {
    const store = useRulerStore();
    const r1 = store.addRuler(createRuler());
    const r2 = store.addRuler(createRuler());

    expect(store.rulers).to.have.length(2);
    expect(store.rulers[0]).to.have.property('id', r1);
    expect(store.rulers[1]).to.have.property('id', r2);
  });

  it('should have a lengthByID getter', () => {
    const store = useRulerStore();
    const r1 = store.addRuler({
      ...createRuler(),
      firstPoint: [0, 0, 0],
      secondPoint: [5, 0, 0],
    });

    const expectedLength = 5;
    expect(store.lengthByID).to.have.property(r1, expectedLength);
  });

  // TODO testing jumpToRuler requires store integration
  // TODO testing (de)serialize requires store integration
});

describe('Ruler segment types', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const selectedTypeId = (store: ReturnType<typeof useRulerStore>) =>
    store.types.selectedTypeId.value as string;

  it('seeds the configured default types', () => {
    const store = useRulerStore();

    expect(store.types.typeList.value.map((type) => type.name)).toEqual(
      Object.keys(RULER_TYPE_DEFAULTS)
    );
    expect(
      store.types.appearanceOf(store.types.typeList.value[0].id)
    ).toMatchObject({
      name: 'Label 1',
      cssColor: rgbaToCssColor(cssColorToRGBA('red')),
      strokeWidth: STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
    });
  });

  it('adds a ruler carrying the type it was given', () => {
    const store = useRulerStore();
    const typeId = store.types.addType({ name: 'Tumor' });

    const id = store.addRuler({ ...createRuler(), typeId });

    expect(store.rulerByID[id].typeId).toBe(typeId);
    expect(store.appearanceOfTool(id).name).toBe('Tumor');
  });

  it('defaults a new ruler to the selected type', () => {
    const store = useRulerStore();
    const id = store.addRuler(createRuler());

    expect(store.rulerByID[id].typeId).toBe(selectedTypeId(store));
  });

  it('continues the tool color cycle past the seeded types', () => {
    const store = useRulerStore();

    const id = store.types.addType({ name: 'Tumor' });

    expect(store.types.appearanceOf(id).cssColor).toBe(
      rgbaToCssColor(cssColorToRGBA(TOOL_COLORS[1]))
    );
    expect(store.types.selectedTypeId.value).toBe(id);
  });

  it('shows a rename on the rulers that reference the type', async () => {
    const store = useRulerStore();
    const typeId = selectedTypeId(store);
    const id = store.addRuler({ ...createRuler(), typeId });

    store.types.updateType(typeId, {
      name: 'Lesion',
      color: cssColorToRGBA('blue'),
    });
    await nextTick();

    expect(store.rulerByID[id].typeId).toBe(typeId);
    expect(store.appearanceOfTool(id)).toMatchObject({
      name: 'Lesion',
      cssColor: rgbaToCssColor(cssColorToRGBA('blue')),
    });
  });

  it('takes the rulers of a deleted type with it', async () => {
    const store = useRulerStore();
    const typeId = selectedTypeId(store);
    const id = store.addRuler({ ...createRuler(), typeId });

    store.types.deleteType(typeId);
    await nextTick();

    expect(store.rulerByID[id]).toBeUndefined();
  });

  it('binds a name to the type already carrying it', () => {
    const store = useRulerStore();

    const id = store.types.typeNamed('Label 1');

    expect(store.types.typeList.value).toHaveLength(1);
    expect(id).toBe(store.types.typeList.value[0].id);
  });

  it('drops the seeded types when a config clears them', () => {
    const store = useRulerStore();

    store.types.replaceConfigTypes({});

    expect(store.types.typeList.value).toEqual([]);
  });

  it('selects a type, including back to unset', () => {
    const store = useRulerStore();
    const typeId = selectedTypeId(store);

    store.types.selectType(undefined);
    expect(store.types.selectedTypeId.value).toBeUndefined();

    store.types.selectType(typeId);
    expect(store.types.selectedTypeId.value).toBe(typeId);
  });

  it('serializes its own registry beside its tools', () => {
    const store = useRulerStore();
    const typeId = selectedTypeId(store);
    store.addRuler({ ...createRuler(), typeId });

    const manifest = { rulerTypes: undefined } as any;
    store.serialize({ zip: {} as any, manifest });
    const { tools } = store.serializeTools();

    expect(manifest.rulerTypes.map((type: any) => type.id)).toEqual([typeId]);
    expect(tools[0].typeId).toBe(typeId);
  });

  it('keeps ruler types out of the shared registry', () => {
    const store = useRulerStore();
    const segmentation = useSegmentationStore().ensureSegmentationForImage('4');

    useSegmentationStore().createSegment(
      segmentation.id,
      mintType({ name: 'Tumor' })
    );

    expect(store.types.typeList.value.map((type) => type.name)).toEqual([
      'Label 1',
    ]);
  });
});
