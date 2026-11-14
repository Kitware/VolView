import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import PolygonTool from '@/src/components/tools/polygon/PolygonTool.vue';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useViewStore } from '@/src/store/views';
import type { ToolID } from '@/src/types/annotation-tool';
import { seatCineImage } from '@/src/core/cine/__tests__/cineFixtures';
import {
  activateAppPinia,
  inMemoryArtifactIO,
  manifestForImages,
  seatImage,
  serializeToStateFiles,
  showImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

enableAutoUnmount(afterEach);

const mountMenu = (polygonId: ToolID, imageId: string) =>
  mount(PolygonTool, {
    props: {
      viewId: useViewStore().activeView!,
      imageId,
      viewDirection: 'Superior',
    },
    global: {
      stubs: {
        PolygonWidget2D: true,
        AnnotationInfo: true,
        AnnotationContextMenu: {
          setup(_, { slots }) {
            return () =>
              h('div', slots.default?.({ context: { forToolID: polygonId } }));
          },
        },
        ReasonedAction: {
          props: ['reason'],
          template: '<div><slot :disabled="Boolean(reason)" /></div>',
        },
        VListItem: {
          props: ['disabled'],
          template: '<button :disabled="disabled"><slot /></button>',
        },
        VListItemTitle: { template: '<span><slot /></span>' },
        VIcon: true,
      },
    },
  });

const rasterizeButton = (wrapper: ReturnType<typeof mountMenu>) =>
  wrapper
    .findAll('button')
    .find((button) => button.text().includes('Rasterize'))!;

const makePolygon = (imageID: string, slice = 2) => {
  const segmentId = useSegmentStore().segments.addSegment(imageID, {
    name: 'Tumor',
  });
  return usePolygonStore().addTool({
    imageID,
    segmentId,
    placing: false,
    slice,
    frameOfReference: {
      planeOrigin: [0, 0, slice],
      planeNormal: [0, 0, 1],
    },
    points: [
      [1, 1, slice],
      [4, 1, slice],
      [4, 4, slice],
      [1, 4, slice],
    ],
  });
};

describe('PolygonTool rasterize context', () => {
  it.each([false, true])(
    'fills the polygon image and saved plane after its view changes image and axis (cine view: %s)',
    async (cineView) => {
      activateAppPinia();
      await seatImage('a', { dimensions: [6, 6, 4] });
      if (cineView) seatCineImage('b');
      else await seatImage('b', { dimensions: [6, 6, 4] });
      await showImage('a');
      const polygonId = makePolygon('a');
      useSegmentStore().segments.addSegment('b', { name: 'Kidney' });
      const wrapper = mountMenu(polygonId, 'a');

      await showImage('b');
      await wrapper.setProps({ imageId: 'b', viewDirection: 'Left' });
      const rasterize = rasterizeButton(wrapper);
      expect(rasterize.attributes('disabled')).toBeUndefined();
      await rasterize.trigger('click');

      const io = inMemoryArtifactIO();
      const { parsed } = await serializeToStateFiles(
        manifestForImages(['a', 'b']),
        io
      );
      expect(parsed.segmentations).toHaveLength(1);
      expect(parsed.segmentations).toMatchObject([{ parentImage: 'a' }]);
      expect(
        parsed.segmentations[0].masks[0].representations.labelmap.extent
      ).toEqual([1, 4, 1, 4, 2, 2]);
      expect(io.snapshots[0].values.some((value) => value !== 0)).toBe(true);
    }
  );

  it('keeps a cine polygon disabled after its view changes to a spatial image', async () => {
    activateAppPinia();
    seatCineImage('cine');
    await seatImage('spatial', { dimensions: [6, 6, 4] });
    await showImage('cine');
    const polygonId = makePolygon('cine', 0);
    const wrapper = mountMenu(polygonId, 'cine');

    await showImage('spatial');
    await wrapper.setProps({ imageId: 'spatial' });

    expect(rasterizeButton(wrapper).attributes('disabled')).toBeDefined();
    const io = inMemoryArtifactIO();
    const { parsed } = await serializeToStateFiles(
      manifestForImages(['cine', 'spatial']),
      io
    );
    expect(parsed.segmentations).toEqual([]);
  });
});
