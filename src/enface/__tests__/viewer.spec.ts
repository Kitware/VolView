import { afterEach, beforeEach, expect, it } from 'vitest';
import { enableAutoUnmount, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import { createVuetify } from 'vuetify';
import EnFaceViewer from '@/src/enface/EnFaceViewer.vue';
import VtkSliceViewWindowManipulator from '@/src/components/vtk/VtkSliceViewWindowManipulator.vue';
import VtkSlabProjectionRepresentation from '@/src/components/vtk/VtkSlabProjectionRepresentation.vue';
import CrosshairsWidget from '@/src/components/tools/crosshairs/CrosshairsWidget.vue';
import { useViewStore } from '@/src/store/views';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useImageStatsStore } from '@/src/store/image-stats';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { createOCTFixture } from '@/tests/unit/octFixture';
import { cleanupCachedImages } from '@/tests/unit/imageCacheCleanup';

const releases: (() => void)[] = [];
beforeEach(() => setActivePinia(createPinia()));
enableAutoUnmount(afterEach);
afterEach(() => cleanupCachedImages(releases));

it('enables pane interactions only when their projection source supports them', async () => {
  const views = useViewStore();
  views.replaceView(views.layoutViews[0].id, {
    name: 'En face',
    type: 'EnFace',
    dataID: null,
    options: {},
  });
  const viewID = views.layoutViews[0].id;
  views.setActiveView(viewID);
  const tools = useToolStore();
  const wrapper = shallowMount(EnFaceViewer, {
    props: { viewId: viewID },
    global: {
      plugins: [createVuetify()],
      stubs: {
        VtkSliceView: defineComponent({
          setup(_, { slots, expose }) {
            expose({ renderWindowView: { getCanvas: () => null } });
            return () => h('div', slots.default?.());
          },
        }),
      },
    },
  });
  const button = () =>
    wrapper
      .getComponent(VtkSliceViewWindowManipulator)
      .props('manipulatorConfig')?.button;
  expect(tools.currentTool).toBe(Tools.WindowLevel);
  expect(button()).toBe(-1);

  useImageStatsStore().stats.oct = {
    scalarMin: 0,
    scalarMax: 768,
    autoRangeValues: {},
  };
  const fixture = createOCTFixture({ deferDecode: true });
  releases.push(fixture.releaseDecode);
  useImageCacheStore().addProgressiveImage(fixture.image, { id: 'oct' });
  await fixture.chunk.loadMeta();
  await fixture.image.addChunks([fixture.chunk]);
  fixture.image.startLoad();
  views.setDataForView(viewID, 'oct');
  await nextTick();
  expect(button()).toBe(-1);

  fixture.releaseDecode();
  await untilLoaded('oct');
  await nextTick();
  expect(tools.currentTool).toBe(Tools.WindowLevel);
  expect(button()).toBe(1);

  tools.setCurrentTool(Tools.Crosshairs);
  await nextTick();
  expect(wrapper.findComponent(CrosshairsWidget).exists()).toBe(true);
  const image = useImageCacheStore().getVtkImageData('oct')!;
  const extent = [...image.getExtent()];
  image.setExtent(
    10,
    extent[1] + 10,
    extent[2],
    extent[3],
    extent[4],
    extent[5]
  );
  await nextTick();
  expect(tools.currentTool).toBe(Tools.Crosshairs);
  expect(wrapper.findComponent(CrosshairsWidget).exists()).toBe(false);

  tools.setCurrentTool(Tools.WindowLevel);

  wrapper
    .getComponent(VtkSlabProjectionRepresentation)
    .vm.$emit('error', 'Lost');
  await nextTick();
  expect(button()).toBe(-1);
});
