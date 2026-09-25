import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';

import {
  useCurrentTools,
  usePlacingAnnotationTool,
} from '@/src/composables/annotationTool';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { AXIAL_FRAME_OF_REFERENCE } from '@/src/utils/frameOfReference';
import { seatCineImage } from '@/src/core/cine/__tests__/cineFixtures';
import {
  viewImage,
  showImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

describe.each([
  ['ruler', useRulerStore],
  ['rectangle', useRectangleStore],
  ['polygon', usePolygonStore],
] as const)('placing a %s in a hidden segment', (_name, useStore) => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await viewImage('img-1');
  });

  it('keeps the active placement alive through hiding, committing and starting again', () => {
    const tools = useStore();
    const segments = useSegmentStore().segments;
    const segmentId = segments.addSegment();
    const metadata = ref({
      imageID: 'img-1',
      segmentId,
      slice: 0,
      frameOfReference: AXIAL_FRAME_OF_REFERENCE,
    });
    const placing = usePlacingAnnotationTool(tools, metadata);
    placing.add();
    const first = placing.id.value!;
    const whitelist = ref([first]);
    const rendered = useCurrentTools(tools, ref('Axial'), whitelist);
    const ids = () => rendered.value.map((tool) => tool.id);
    const otherViewStub = tools.addTool({ ...metadata.value, placing: true });
    const otherView = useCurrentTools(
      tools,
      ref('Axial'),
      ref([otherViewStub])
    );

    placing.beginPlacement();
    segments.updateSegment(segmentId, { visible: false });
    expect(ids()).toEqual([first]);
    expect(otherView.value.map((tool) => tool.id)).toEqual([otherViewStub]);

    placing.commit();
    expect(ids()).toEqual([]);
    placing.add();
    whitelist.value = [placing.id.value!];
    expect(ids()).toEqual([placing.id.value]);
    segments.updateSegment(segmentId, { visible: true });
    expect(ids()).toEqual([first, placing.id.value]);
    placing.remove();
    expect(ids()).toEqual([first]);
  });
});

describe.each([
  ['ruler', useRulerStore],
  ['rectangle', useRectangleStore],
  ['polygon', usePolygonStore],
] as const)('shared segment visibility for a %s', (_name, useStore) => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await viewImage('img-1');
  });

  it('filters hidden segments and shapes across images and cine frames', async () => {
    const tools = useStore();
    const segments = useSegmentStore().segments;
    const segmentId = segments.addSegment();
    const addShape = (imageID: string, hidden = false, frame?: number) =>
      tools.addTool({
        imageID,
        segmentId,
        slice: 0,
        frameOfReference: AXIAL_FRAME_OF_REFERENCE,
        hidden,
        frame,
      });
    const shown = addShape('img-1');
    addShape('img-1', true);
    seatCineImage('cine-1');
    const cineFirst = addShape('cine-1', false, 0);
    const cineSecond = addShape('cine-1', false, 1);
    const viewFrame = ref<number | undefined>();
    const rendered = useCurrentTools(tools, ref('Axial'), ref([]), viewFrame);
    const ids = () => rendered.value.map((tool) => tool.id);
    expect(ids()).toEqual([shown]);

    segments.updateSegment(segmentId, { visible: false });
    expect(ids()).toEqual([]);
    await showImage('cine-1');
    viewFrame.value = 0;
    expect(ids()).toEqual([]);
    segments.updateSegment(segmentId, { visible: true });
    expect(ids()).toEqual([cineFirst]);
    viewFrame.value = 1;
    expect(ids()).toEqual([cineSecond]);
    segments.updateSegment(segmentId, { visible: false });
    expect(ids()).toEqual([]);
    segments.updateSegment(segmentId, { visible: true });
    await showImage('img-1');
    viewFrame.value = undefined;
    expect(ids()).toEqual([shown]);
  });
});
