import { describe, it, beforeEach, expect } from 'vitest';

import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import {
  RULER_LABEL_DEFAULTS,
  STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
  TOOL_COLORS,
} from '@/src/config';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useRulerStore } from '@/src/store/tools/rulers';
import { Ruler } from '@/src/types/ruler';
import { RequiredWithPartial } from '@/src/types';
import { ToolID } from '@/src/types/annotation-tool';

function createRuler(): RequiredWithPartial<
  Ruler,
  | 'id'
  | 'color'
  | 'strokeWidth'
  | 'label'
  | 'labelName'
  | 'hidden'
  | 'metadata'
  | 'frame'
  | 'source'
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

describe('Ruler store labels', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const activeLabelID = (store: ReturnType<typeof useRulerStore>) =>
    store.activeLabel as string;

  it('seeds and activates the configured default labels', () => {
    const store = useRulerStore();

    expect(Object.values(store.labels).map((label) => label.labelName)).toEqual(
      Object.keys(RULER_LABEL_DEFAULTS)
    );
    expect(store.labels[activeLabelID(store)]).toMatchObject({
      labelName: 'Label 1',
      color: 'red',
      strokeWidth: STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
    });
  });

  it('adds a ruler carrying the active label', () => {
    const store = useRulerStore();
    const label = activeLabelID(store);

    const id = store.addRuler({ ...createRuler(), label });

    expect(store.rulerByID[id]).toMatchObject({
      label,
      labelName: 'Label 1',
      color: 'red',
      strokeWidth: STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
    });
  });

  it('defaults a new ruler to the active label', () => {
    const store = useRulerStore();
    const id = store.addRuler(createRuler());

    expect(store.rulerByID[id].label).toBe(store.activeLabel);
  });

  it('continues the tool color cycle past the seeded labels', () => {
    const store = useRulerStore();

    const id = store.addLabel({ labelName: 'Tumor' });

    expect(store.labels[id].color).toBe(TOOL_COLORS[1]);
    expect(store.activeLabel).toBe(id);
  });

  it('propagates a label rename to existing rulers', async () => {
    const store = useRulerStore();
    const label = activeLabelID(store);
    const id = store.addRuler({ ...createRuler(), label });

    store.updateLabel(label, { labelName: 'Lesion', color: 'blue' });
    await nextTick();

    expect(store.rulerByID[id]).toMatchObject({
      labelName: 'Lesion',
      color: 'blue',
    });
  });

  it('clears the label name of rulers whose label was deleted', async () => {
    const store = useRulerStore();
    const label = activeLabelID(store);
    const id = store.addRuler({ ...createRuler(), label });

    store.deleteLabel(label);
    await nextTick();

    expect(store.rulerByID[id].labelName).toBe('');
  });

  it('merges labels by name and reports them through findLabel', () => {
    const store = useRulerStore();

    store.mergeLabels({ 'Label 1': { color: 'green' } });

    expect(Object.keys(store.labels)).toHaveLength(1);
    expect(store.findLabel('Label 1')?.[1]).toMatchObject({ color: 'green' });
  });

  it('drops the seeded labels on clearDefaultLabels', () => {
    const store = useRulerStore();

    store.clearDefaultLabels();

    expect(store.labels).toEqual({});
  });

  it('sets the active label, including back to unset', () => {
    const store = useRulerStore();
    const label = activeLabelID(store);

    store.setActiveLabel(undefined);
    expect(store.activeLabel).toBeUndefined();

    store.setActiveLabel(label);
    expect(store.activeLabel).toBe(label);
  });

  it('serializes its own labels', () => {
    const store = useRulerStore();
    const label = activeLabelID(store);
    store.addRuler({ ...createRuler(), label });

    const { labels, tools } = store.serializeTools();

    expect(labels).toEqual(store.labels);
    expect(tools[0].label).toBe(label);
  });

  it('keeps ruler labels out of the segmentation store', () => {
    const store = useRulerStore();
    const segmentation = useSegmentationStore().ensureSegmentationForImage('4');

    useSegmentationStore().createSegment(segmentation.id, { name: 'Tumor' });

    expect(Object.values(store.labels).map((label) => label.labelName)).toEqual(
      ['Label 1']
    );
  });
});
