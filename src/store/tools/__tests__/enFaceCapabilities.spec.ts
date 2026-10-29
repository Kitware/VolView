import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import ControlsStripTools from '@/src/components/ControlsStripTools.vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import {
  isToolAllowedFor,
  getToolUnavailableReason,
  useToolStore,
} from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import {
  computeEffectiveView,
  getEffectiveView,
} from '@/src/core/views/effectiveView';
import { useViewStore } from '@/src/store/views';
import { useImageCacheStore } from '@/src/store/image-cache';
import { getEnFaceAvailability } from '@/src/enface';
import { createOCTFixture } from '@/tests/unit/octFixture';
import { cleanupCachedImages } from '@/tests/unit/imageCacheCleanup';
import { untilLoaded } from '@/src/composables/untilLoaded';
import type { ViewInfoEnFace } from '@/src/types/views';

const view: ViewInfoEnFace = {
  id: 'en-face-view',
  name: 'En face',
  type: 'EnFace',
  dataID: 'retina-oct',
  options: {},
};
const enFace = computeEffectiveView(view, view.dataID);
const supportedTools = new Set([
  Tools.Select,
  Tools.WindowLevel,
  Tools.Pan,
  Tools.Zoom,
  Tools.Crosshairs,
]);

function activateEnFace(dataID = view.dataID) {
  const views = useViewStore();
  const previous = views.layoutViews[0].id;
  views.replaceView(previous, {
    name: view.name,
    type: view.type,
    dataID,
    options: {},
  });
  const current = views.layoutViews[0].id;
  views.setActiveView(current);
  return current;
}

const decodeReleases: (() => void)[] = [];
async function loadOCT(
  id = 'retina-oct',
  options: Parameters<typeof createOCTFixture>[0] = {}
) {
  const fixture = createOCTFixture(options);
  decodeReleases.push(fixture.releaseDecode);
  useImageCacheStore().addProgressiveImage(fixture.image, { id });
  await fixture.chunk.loadMeta();
  await fixture.image.addChunks([fixture.chunk]);
  fixture.image.startLoad();
  if (!options.deferDecode) await untilLoaded(id);
  return id;
}

function addRegularVolume(flat = false) {
  const image = vtkImageData.newInstance();
  image.setDimensions(2, 2, flat ? 1 : 2);
  image
    .getPointData()
    .setScalars(
      vtkDataArray.newInstance({ values: new Uint8Array(flat ? 4 : 8) })
    );
  return useImageCacheStore().addVTKImageData(image, 'Regular volume', {
    id: 'regular-volume',
  });
}

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => cleanupCachedImages(decodeReleases));
afterEach(() => vi.unstubAllGlobals());
enableAutoUnmount(afterEach);

async function crosshairsChord(type: 'keydown' | 'keyup') {
  const keys = type === 'keydown' ? ['Shift', 'C'] : ['C', 'Shift'];
  keys.forEach((key) =>
    window.dispatchEvent(
      new KeyboardEvent(type, {
        key,
        code: key === 'C' ? 'KeyC' : 'ShiftLeft',
        shiftKey: type === 'keydown' || key === 'C',
        bubbles: true,
      })
    )
  );
  await nextTick();
}

describe('temporary crosshairs in the toolbar', () => {
  it.each(['denied', 'successful', 'En face', 'focus change'])(
    'preserves selection after a %s hold',
    async (scenario) => {
      const imageID = await loadOCT();
      const views = useViewStore();
      views.setDataForAllViews(imageID);
      if (scenario === 'denied') activateEnFace(addRegularVolume(true));
      if (scenario === 'En face') activateEnFace(imageID);
      vi.stubGlobal('visualViewport', null);
      const toolbar = mount(ControlsStripTools, {
        attachTo: document.body,
        global: { plugins: [createVuetify()] },
      });
      const initial =
        scenario === 'focus change'
          ? 'Ruler'
          : scenario === 'denied'
            ? 'Select'
            : 'Pan';
      const button = (name: string) =>
        toolbar.get('button[data-testid^="control-button-' + name + ' "]');
      await button(initial).trigger('click');
      expect(button(initial).classes()).toContain('tool-btn-selected');
      await crosshairsChord('keydown');
      expect(
        button(scenario === 'denied' ? initial : 'Crosshairs').classes()
      ).toContain('tool-btn-selected');
      if (scenario === 'focus change') {
        activateEnFace(imageID);
        await nextTick();
        expect(button('Crosshairs').classes()).toContain('tool-btn-selected');
      }
      await crosshairsChord('keyup');
      expect(
        button(scenario === 'focus change' ? 'Select' : initial).classes()
      ).toContain('tool-btn-selected');
    }
  );
});

describe('En face tool capabilities', () => {
  it('keeps offset-grid projection available while disabling Crosshairs and its shortcut with a shared reason', async () => {
    const dataID = addRegularVolume();
    useImageCacheStore()
      .getVtkImageData(dataID)!
      .setExtent(10, 11, 0, 1, 30, 31);
    activateEnFace(dataID);
    vi.stubGlobal('visualViewport', null);
    const toolbar = mount(ControlsStripTools, {
      attachTo: document.body,
      global: { plugins: [createVuetify()] },
    });
    const selector = 'button[data-testid^="control-button-Crosshairs "]';
    const reason = getToolUnavailableReason(
      Tools.Crosshairs,
      getEffectiveView(useViewStore().activeView)
    );
    expect(getEnFaceAvailability(dataID).available).toBe(true);
    expect(toolbar.get(selector).attributes('disabled')).toBeDefined();
    const action = toolbar
      .findAllComponents(ReasonedAction)
      .find((candidate) => candidate.find(selector).exists())!;
    expect(action.props('reason')).toBe(reason);
    expect(reason).toMatch(/nonzero starting voxel indices/);
    const tools = useToolStore();
    tools.setCurrentTool(Tools.Crosshairs);
    expect(tools.currentTool).toBe(Tools.Select);
    tools.setCurrentTool(Tools.WindowLevel);
    await crosshairsChord('keydown');
    expect(tools.currentTool).toBe(Tools.WindowLevel);
    await crosshairsChord('keyup');
    expect(tools.currentTool).toBe(Tools.WindowLevel);
  });
  it.each(Object.values(Tools))(
    'supports viewing tools when evaluating %s',
    (tool) => {
      expect(isToolAllowedFor(tool, enFace)).toBe(supportedTools.has(tool));
    }
  );
  it.each(Object.values(Tools))(
    'preserves tool %s availability without an active view',
    (tool) => {
      expect(isToolAllowedFor(tool, null)).toBe(true);
    }
  );
});

describe('activating an En face view', () => {
  it('keeps Pan selected when changing to an En face view', async () => {
    const tools = useToolStore();
    tools.setCurrentTool(Tools.Pan);
    activateEnFace(await loadOCT());
    await nextTick();
    expect(tools.currentTool).toBe(Tools.Pan);
  });
  it('keeps the standard window/level tool active when supported OCT pixels are loaded', async () => {
    const tools = useToolStore();
    expect(tools.currentTool).toBe(Tools.WindowLevel);
    activateEnFace(await loadOCT());
    await nextTick();
    expect(tools.currentTool).toBe(Tools.WindowLevel);
  });
  it('allows the contrast shortcut while refusing unsupported projection tools', async () => {
    activateEnFace(await loadOCT());
    const tools = useToolStore();
    await nextTick();
    expect(tools.currentTool).toBe(Tools.WindowLevel);
    for (const tool of Object.values(Tools)) {
      tools.setCurrentTool(tool);
      expect(tools.currentTool).toBe(
        supportedTools.has(tool) ? tool : Tools.Select
      );
    }
    tools.setCurrentTool(Tools.WindowLevel);
    tools.activateTemporaryCrosshairs();
    expect(tools.currentTool).toBe(Tools.Crosshairs);
    tools.deactivateTemporaryCrosshairs();
    expect(tools.currentTool).toBe(Tools.WindowLevel);
    expect(tools.paintUnavailableReason).toContain('En face projection');
  });
  it('allows standard contrast for a manually projected generic volume', async () => {
    const dataID = addRegularVolume();
    activateEnFace(dataID);
    const tools = useToolStore();
    await nextTick();
    expect(getEnFaceAvailability(dataID)).toMatchObject({
      available: true,
      isOCT: false,
    });
    tools.setCurrentTool(Tools.WindowLevel);
    expect(tools.currentTool).toBe(Tools.WindowLevel);
    expect(
      getToolUnavailableReason(
        Tools.WindowLevel,
        getEffectiveView(useViewStore().activeView)
      )
    ).toBeNull();
  });

  it.each(['2D', 'radial', 'incomplete', 'missing'])(
    'disables contrast after replacing En face with %s data without changing the view kind',
    async (replacement) => {
      const viewID = activateEnFace(await loadOCT());
      const tools = useToolStore();
      expect(tools.currentTool).toBe(Tools.WindowLevel);
      let dataID = 'missing';
      if (replacement === '2D') dataID = addRegularVolume(true);
      if (replacement === 'radial')
        dataID = await loadOCT('radial', { scanPattern: '128282' });
      if (replacement === 'incomplete')
        dataID = await loadOCT('pending', { deferDecode: true });
      useViewStore().setDataForView(viewID, dataID);
      await nextTick();
      const effective = getEffectiveView(viewID);
      expect(effective?.kind).toBe('enface');
      expect(getToolUnavailableReason(Tools.WindowLevel, effective)).toBe(
        getEnFaceAvailability(dataID).reason
      );
      expect(
        getToolUnavailableReason(Tools.WindowLevel, effective)
      ).toBeTruthy();
      expect(tools.currentTool).toBe(Tools.Select);
      tools.setCurrentTool(Tools.WindowLevel);
      expect(tools.currentTool).toBe(Tools.Select);
    }
  );
  it.each([Tools.WindowLevel, Tools.Pan, Tools.Zoom, Tools.Crosshairs])(
    'rejects the %s shortcut in an En face slot with no dataset',
    async (tool) => {
      activateEnFace(null);
      const tools = useToolStore();
      await nextTick();
      tools.setCurrentTool(tool);
      expect(tools.currentTool).toBe(Tools.Select);
    }
  );
  it('declines temporary Crosshairs until a projection source is available', async () => {
    activateEnFace(addRegularVolume(true));
    const tools = useToolStore();
    await nextTick();
    tools.activateTemporaryCrosshairs();
    expect(tools.currentTool).toBe(Tools.Select);
    tools.deactivateTemporaryCrosshairs();
    expect(tools.currentTool).toBe(Tools.Select);
  });
  it('preserves normal-view contrast shortcuts when their dataset is missing', () => {
    const views = useViewStore();
    views.setDataForView(views.layoutViews[0].id, 'missing');
    const tools = useToolStore();
    tools.setCurrentTool(Tools.WindowLevel);
    expect(tools.currentTool).toBe(Tools.WindowLevel);
  });
});
