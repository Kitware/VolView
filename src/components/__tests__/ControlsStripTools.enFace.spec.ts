import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createVuetify } from 'vuetify';
import { nextTick } from 'vue';
import ControlsStripTools from '@/src/components/ControlsStripTools.vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { useViewStore } from '@/src/store/views';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { useImageCacheStore } from '@/src/store/image-cache';
import { getOCTAvailability } from '@/src/oct';
import { createOCTFixture } from '@/tests/unit/octFixture';
import { cleanupCachedImages } from '@/tests/unit/imageCacheCleanup';
import { untilLoaded } from '@/src/composables/untilLoaded';

const windowTool = 'button[data-testid^="control-button-Window & Level "]';
enableAutoUnmount(afterEach);
const decodeReleases: (() => void)[] = [];
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => cleanupCachedImages(decodeReleases));

function mountToolbar(dataID: string | null) {
  const views = useViewStore();
  views.replaceView(views.layoutViews[0].id, {
    type: 'EnFace',
    name: 'En face',
    options: {},
    dataID,
  });
  views.setActiveView(views.layoutViews[0].id);
  return mount(ControlsStripTools, {
    attachTo: document.body,
    global: { plugins: [createVuetify()] },
  });
}

function windowAction(wrapper: ReturnType<typeof mountToolbar>) {
  return wrapper
    .findAllComponents(ReasonedAction)
    .find((action) => action.find(windowTool).exists())!;
}

describe('En face contrast toolbar availability', () => {
  it.each([null, 'missing'])(
    'keeps unavailable contrast visible and disabled with the same reason as shortcut coercion for %s',
    async (dataID) => {
      const wrapper = mountToolbar(dataID);
      const reason = getOCTAvailability(dataID).reason;
      expect(wrapper.get(windowTool).attributes('disabled')).toBeDefined();
      expect(windowAction(wrapper).props('reason')).toBe(reason);
      expect(windowAction(wrapper).attributes('tabindex')).toBe('0');
      useToolStore().setCurrentTool(Tools.WindowLevel);
      await nextTick();
      expect(useToolStore().currentTool).toBe(Tools.Select);
    }
  );

  it('updates the disabled reason as metadata arrives and enables contrast once real OCT pixels finish loading', async () => {
    const fixture = createOCTFixture({ deferDecode: true });
    decodeReleases.push(fixture.releaseDecode);
    useImageCacheStore().addProgressiveImage(fixture.image, { id: 'pending' });
    const wrapper = mountToolbar('pending');
    expect(wrapper.get(windowTool).attributes('disabled')).toBeDefined();
    expect(windowAction(wrapper).props('reason')).toMatch(/ophthalmic OCT/);
    await fixture.chunk.loadMeta();
    await fixture.image.addChunks([fixture.chunk]);
    await nextTick();
    expect(wrapper.get(windowTool).attributes('disabled')).toBeDefined();
    expect(windowAction(wrapper).props('reason')).toMatch(
      /complete OCT volume/
    );
    fixture.image.startLoad();
    fixture.releaseDecode();
    await untilLoaded('pending');
    await nextTick();
    expect(wrapper.get(windowTool).attributes('disabled')).toBeUndefined();
    expect(windowAction(wrapper).props('reason')).toBeUndefined();
    useToolStore().setCurrentTool(Tools.WindowLevel);
    await nextTick();
    expect(useToolStore().currentTool).toBe(Tools.WindowLevel);
    expect(wrapper.get(windowTool).classes()).toContain('tool-btn-selected');
  });

  it('shows the actual radial-scan reconstruction reason on a loaded unsupported OCT', async () => {
    const fixture = createOCTFixture({ scanPattern: '128282' });
    decodeReleases.push(fixture.releaseDecode);
    useImageCacheStore().addProgressiveImage(fixture.image, { id: 'radial' });
    await fixture.chunk.loadMeta();
    await fixture.image.addChunks([fixture.chunk]);
    fixture.image.startLoad();
    await untilLoaded('radial');
    const wrapper = mountToolbar('radial');
    expect(wrapper.get(windowTool).attributes('disabled')).toBeDefined();
    expect(windowAction(wrapper).props('reason')).toBe(
      getOCTAvailability('radial').reason
    );
    expect(windowAction(wrapper).props('reason')).toMatch(
      /scan pattern.*reconstruction/
    );
  });
});
