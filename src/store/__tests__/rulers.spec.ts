import { describe, it, beforeEach, expect } from 'vitest';
import JSZip from 'jszip';
import type { Manifest } from '@/src/io/state-file/schema';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';

import { setActivePinia, createPinia } from 'pinia';
import { mintSegment } from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';
import { STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT } from '@/src/config';
import { cssColorToRGBA, rgbaToCssColor } from '@/src/segmentation/color';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
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

describe('Ruler segment references', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const segments = () => useSegmentStore().segments;

  // Adding selects, so this is the segment a new ruler picks up.
  const seedSegment = () => segments().addSegment({ name: 'Tumor' });

  it('draws out of the shared registry', () => {
    const store = useRulerStore();
    seedSegment();

    const id = store.addRuler(createRuler());

    expect(store.appearanceOfTool(id)).toMatchObject({
      name: 'Tumor',
      strokeWidth: STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
    });
  });

  it('adds a ruler carrying the segment it was given', () => {
    const store = useRulerStore();
    const segmentId = seedSegment();

    const id = store.addRuler({ ...createRuler(), segmentId });

    expect(store.rulerByID[id].segmentId).toBe(segmentId);
    expect(store.appearanceOfTool(id).name).toBe('Tumor');
  });

  it('defaults a new ruler to the selected segment', () => {
    const store = useRulerStore();
    const segmentId = seedSegment();

    const id = store.addRuler(createRuler());

    expect(store.rulerByID[id].segmentId).toBe(segmentId);
  });

  it('shows a rename on the rulers that reference the segment', async () => {
    const store = useRulerStore();
    const segmentId = seedSegment();
    const id = store.addRuler({ ...createRuler(), segmentId });

    segments().updateSegment(segmentId, {
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

  it('takes the rulers of a deleted segment with it', async () => {
    const store = useRulerStore();
    const segmentId = seedSegment();
    const id = store.addRuler({ ...createRuler(), segmentId });

    segments().deleteSegment(segmentId);
    await nextTick();

    expect(store.rulerByID[id]).toBeUndefined();
  });

  it('serializes ruler geometry with its shared segment reference', () => {
    const store = useRulerStore();
    const segmentId = seedSegment();
    const ruler = createRuler();
    const id = store.addRuler({ ...ruler, segmentId });
    const manifest: Manifest = {
      version: MANIFEST_VERSION,
      dataSources: [],
      tools: {},
    };

    store.serialize({ zip: new JSZip(), manifest });

    expect(manifest.tools?.rulers).toMatchObject({
      tools: [{ ...ruler, id, segmentId }],
    });
  });

  it('shares the registry with the masks painted on an image', () => {
    const store = useRulerStore();
    const segmentation = useSegmentationStore().ensureSegmentationForImage('4');

    const painted = useSegmentationStore().createMask(
      segmentation.id,
      mintSegment({ name: 'Tumor' })
    );

    const id = store.addRuler({
      ...createRuler(),
      segmentId: painted.segmentId,
    });

    expect(store.appearanceOfTool(id).name).toBe('Tumor');
  });
});
