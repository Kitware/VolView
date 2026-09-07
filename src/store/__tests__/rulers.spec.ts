import { describe, it, beforeEach, expect } from 'vitest';

import { setActivePinia, createPinia } from 'pinia';
import { mintSegment } from '@/src/store/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';
import {
  STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
  TOOL_COLORS,
} from '@/src/config';
import { cssColorToRGBA, rgbaToCssColor } from '@/src/types/segmentation';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';
import { useRulerStore } from '@/src/store/tools/rulers';
import { Ruler } from '@/src/types/ruler';
import { RequiredWithPartial } from '@/src/types';
import { ToolID } from '@/src/types/annotation-tool';

function createRuler(): RequiredWithPartial<
  Ruler,
  'id' | 'segmentId' | 'hidden' | 'metadata' | 'frame' | 'source'
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

describe('Ruler segment segments', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // Adding selects, so this is the segment a new ruler picks up.
  const seedSegment = (store: ReturnType<typeof useRulerStore>) =>
    store.segments.addSegment({ name: 'Tumor' });

  it('draws out of the shared registry', () => {
    const store = useRulerStore();
    const segmentId = useSegmentStore().segments.addSegment({ name: 'Tumor' });

    expect(store.segments.getSegment(segmentId)?.name).toBe('Tumor');
    expect(store.segments.appearanceOf(segmentId)).toMatchObject({
      name: 'Tumor',
      strokeWidth: STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
    });
  });

  it('adds a ruler carrying the type it was given', () => {
    const store = useRulerStore();
    const segmentId = store.segments.addSegment({ name: 'Tumor' });

    const id = store.addRuler({ ...createRuler(), segmentId });

    expect(store.rulerByID[id].segmentId).toBe(segmentId);
    expect(store.appearanceOfTool(id).name).toBe('Tumor');
  });

  it('defaults a new ruler to the selected type', () => {
    const store = useRulerStore();
    const segmentId = seedSegment(store);

    const id = store.addRuler(createRuler());

    expect(store.rulerByID[id].segmentId).toBe(segmentId);
  });

  it('colors a new segment from the tool palette', () => {
    const store = useRulerStore();

    const id = seedSegment(store);

    expect(store.segments.appearanceOf(id).cssColor).toBe(
      rgbaToCssColor(cssColorToRGBA(TOOL_COLORS[0]))
    );
    expect(store.segments.selectedSegmentId.value).toBe(id);
  });

  it('shows a rename on the rulers that reference the type', async () => {
    const store = useRulerStore();
    const segmentId = seedSegment(store);
    const id = store.addRuler({ ...createRuler(), segmentId });

    store.segments.updateSegment(segmentId, {
      name: 'Lesion',
      color: cssColorToRGBA('blue'),
    });
    await nextTick();

    expect(store.rulerByID[id].segmentId).toBe(segmentId);
    expect(store.appearanceOfTool(id)).toMatchObject({
      name: 'Lesion',
      cssColor: rgbaToCssColor(cssColorToRGBA('blue')),
    });
  });

  it('takes the rulers of a deleted type with it', async () => {
    const store = useRulerStore();
    const segmentId = seedSegment(store);
    const id = store.addRuler({ ...createRuler(), segmentId });

    store.segments.deleteSegment(segmentId);
    await nextTick();

    expect(store.rulerByID[id]).toBeUndefined();
  });

  it('binds a name to the type already carrying it', () => {
    const store = useRulerStore();
    const segmentId = seedSegment(store);

    const id = store.segments.segmentNamed('Tumor');

    expect(store.segments.segmentList.value).toHaveLength(1);
    expect(id).toBe(segmentId);
  });

  it('selects a type, including back to unset', () => {
    const store = useRulerStore();
    const segmentId = seedSegment(store);

    store.segments.selectSegment(undefined);
    expect(store.segments.selectedSegmentId.value).toBeUndefined();

    store.segments.selectSegment(segmentId);
    expect(store.segments.selectedSegmentId.value).toBe(segmentId);
  });

  it('names its segments in the shared list, not one of its own', () => {
    const store = useRulerStore();
    const segmentId = seedSegment(store);
    store.addRuler({ ...createRuler(), segmentId });

    const manifest = { tools: {} } as any;
    store.serialize({ zip: {} as any, manifest });
    const { tools } = store.serializeTools();

    // The shared store writes the segments; a ruler only references one.
    expect(manifest.rulerSegments).toBeUndefined();
    expect(tools[0].segmentId).toBe(segmentId);
  });

  it('shares the registry with the masks painted on an image', () => {
    const store = useRulerStore();
    const segmentation = useSegmentationStore().ensureSegmentationForImage('4');

    const painted = useSegmentationStore().createMask(
      segmentation.id,
      mintSegment({ name: 'Tumor' })
    );

    expect(store.segments.getSegment(painted.segmentId)?.name).toBe('Tumor');
  });
});
