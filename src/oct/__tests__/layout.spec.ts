import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createVuetify } from 'vuetify';
import { VListItem } from 'vuetify/components';
import { nextTick, ref } from 'vue';
import LayoutSelector from '@/src/components/LayoutSelector.vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { CurrentImageInjectionKey } from '@/src/composables/useCurrentImage';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { Tags } from '@/src/core/dicomTags';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { useOCTViewStore } from '@/src/oct/store';
import OCTLayoutAction from '@/src/oct/OCTLayoutAction.vue';
import {
  applyOCTLayout,
  getOCTLayoutReason,
  OCT_LAYOUT_NAME,
} from '@/src/oct/layout';
import { createOCTFixture } from '@/tests/unit/octFixture';
import { cleanupCachedImages } from '@/tests/unit/imageCacheCleanup';

const decodeReleases: (() => void)[] = [];
enableAutoUnmount(afterEach);
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => cleanupCachedImages(decodeReleases));

async function loadFixture(
  id: string,
  options: { scanPattern?: string; orientation?: string } = {}
) {
  const fixture = createOCTFixture(options);
  decodeReleases.push(fixture.releaseDecode);
  useImageCacheStore().addProgressiveImage(fixture.image, { id });
  await fixture.chunk.loadMeta();
  if (options.orientation) {
    const entry = fixture.chunk.metadata!.find(
      ([tag]) => tag === Tags.ImageOrientationPatient
    )!;
    entry[1] = options.orientation;
  }
  await fixture.image.addChunks([fixture.chunk]);
  fixture.image.startLoad();
  await untilLoaded(id);
  return fixture;
}

function mountSelector(localImageId?: string) {
  return mount(LayoutSelector, {
    attachTo: document.body,
    global: {
      plugins: [createVuetify()],
      provide: localImageId
        ? {
            [CurrentImageInjectionKey as symbol]: {
              imageID: ref(localImageId),
            },
          }
        : undefined,
    },
  });
}

function action(wrapper: ReturnType<typeof mountSelector>) {
  return wrapper.getComponent(OCTLayoutAction);
}

function focusImage(imageID: string) {
  const views = useViewStore();
  const view = views.layoutViews[0];
  views.setDataForView(view.id, imageID);
  views.setActiveView(view.id);
}

describe('production Retinal OCT layout', () => {
  it('keeps the built-in action visible with a reason without replacing customer layouts', () => {
    const views = useViewStore();
    views.setNamedLayoutsFromConfig({ 'Customer layout': [['volume']] });
    const presets = views.namedLayouts;
    const wrapper = mountSelector();
    expect(wrapper.text()).toContain('Customer layout');
    expect(wrapper.get('[data-testid="oct-layout"]').text()).toContain(
      OCT_LAYOUT_NAME
    );
    expect(action(wrapper).getComponent(VListItem).props('disabled')).toBe(
      true
    );
    const reasoned = action(wrapper).getComponent(ReasonedAction);
    expect(reasoned.props('reason')).toMatch(/ophthalmic OCT/);
    expect(reasoned.attributes('tabindex')).toBe('0');
    expect(applyOCTLayout(null)).toBe(false);
    expect(views.namedLayouts).toBe(presets);
    expect(Object.keys(views.namedLayouts)).toEqual(['Customer layout']);
  });

  it('distinguishes a customer preset with the same display name from the built-in action', async () => {
    await loadFixture('oct');
    focusImage('oct');
    const views = useViewStore();
    views.setNamedLayoutsFromConfig({ [OCT_LAYOUT_NAME]: [['volume']] });
    views.switchToNamedLayout(OCT_LAYOUT_NAME);
    const wrapper = mountSelector();
    const builtin = action(wrapper).getComponent(VListItem);
    const customer = wrapper
      .findAllComponents(VListItem)
      .find((item) => item.attributes('data-testid') !== 'oct-layout')!;
    expect(customer.props('active')).toBe(true);
    expect(builtin.props('active')).toBe(false);
    expect(builtin.text()).toContain('B-scan + en face');
    await wrapper.get('[data-testid="oct-layout"]').trigger('click');
    expect(customer.props('active')).toBe(false);
    expect(builtin.props('active')).toBe(true);
    expect(views.currentLayoutName).toBeNull();
    expect(Object.keys(views.namedLayouts)).toEqual([OCT_LAYOUT_NAME]);
    views.setLayoutFromGrid([2, 1]);
    await nextTick();
    expect(builtin.props('active')).toBe(false);
    views.setNamedLayoutsFromConfig({
      [OCT_LAYOUT_NAME]: [['axial'], ['enface']],
    });
    views.switchToNamedLayout(OCT_LAYOUT_NAME);
    await nextTick();
    expect(customer.props('active')).toBe(true);
    expect(builtin.props('active')).toBe(false);
  });
  it('becomes available only after real OCT metadata and all pixels arrive', async () => {
    const fixture = createOCTFixture({ deferDecode: true });
    decodeReleases.push(fixture.releaseDecode);
    useImageCacheStore().addProgressiveImage(fixture.image, { id: 'pending' });
    focusImage('pending');
    const wrapper = mountSelector();
    expect(action(wrapper).getComponent(VListItem).props('disabled')).toBe(
      true
    );
    await fixture.chunk.loadMeta();
    await fixture.image.addChunks([fixture.chunk]);
    await nextTick();
    expect(
      action(wrapper).getComponent(ReasonedAction).props('reason')
    ).toMatch(/complete OCT volume/);
    const previousLayout = useViewStore().visibleLayout;
    expect(applyOCTLayout('pending')).toBe(false);
    expect(useViewStore().visibleLayout).toBe(previousLayout);
    fixture.image.startLoad();
    fixture.releaseDecode();
    await untilLoaded('pending');
    await nextTick();
    expect(action(wrapper).getComponent(VListItem).props('disabled')).toBe(
      false
    );
    await wrapper.get('[data-testid="oct-layout"]').trigger('click');
    expect(
      useViewStore().visibleViews.map(({ type, dataID }) => ({ type, dataID }))
    ).toEqual([
      { type: '2D', dataID: 'pending' },
      { type: 'EnFace', dataID: 'pending' },
    ]);
  });

  it('binds both panes to the global active image while preserving hidden views and customer presets', async () => {
    await loadFixture('oct-a');
    await loadFixture('oct-b');
    const views = useViewStore();
    const original = [...views.layoutViews];
    original.forEach(({ id }, index) =>
      views.setDataForView(id, index === 2 ? 'oct-b' : 'oct-a')
    );
    views.setActiveView(original[2].id);
    views.setNamedLayoutsFromConfig({ 'Customer layout': [['volume']] });
    const presets = views.namedLayouts;
    const hidden = original.slice(2).map(({ id, dataID }) => ({ id, dataID }));
    // A local provider deliberately disagrees; this global action must use the active view.
    const wrapper = mountSelector('oct-a');
    await wrapper.get('[data-testid="oct-layout"]').trigger('click');
    expect(views.visibleViews.map(({ dataID }) => dataID)).toEqual([
      'oct-b',
      'oct-b',
    ]);
    expect(views.visibleViews.map(({ type }) => type)).toEqual([
      '2D',
      'EnFace',
    ]);
    hidden.forEach(({ id, dataID }) =>
      expect(views.getView(id)?.dataID).toBe(dataID)
    );
    expect(views.namedLayouts).toBe(presets);
    expect(views.currentLayoutName).toBeNull();
    expect(views.visibleLayout.direction).toBe('column');
  });

  it('chooses the source orientation that slices native grid Z on permuted DICOM geometry', async () => {
    await loadFixture('rotated', { orientation: '0\\0\\1\\1\\0\\0' });
    const metadata = useImageCacheStore().getImageMetadata('rotated')!;
    expect(metadata.lpsOrientation.Coronal).toBe(2);
    expect(applyOCTLayout('rotated')).toBe(true);
    expect(useViewStore().visibleViews[0]).toMatchObject({
      type: '2D',
      dataID: 'rotated',
      options: { orientation: 'Coronal' },
    });
  });

  it.each(['2D', 'EnFace'] as const)(
    'guards disabled %s views and keeps the explanation visible',
    async (type) => {
      await loadFixture('oct');
      const views = useViewStore();
      const volume = views.layoutViews.find((view) => view.type === '3D')!;
      views.setDataForView(volume.id, 'oct');
      views.setActiveView(volume.id);
      views.disabledViewTypes = [type];
      await nextTick();
      const previousLayout = views.visibleLayout;
      const wrapper = mountSelector();
      expect(action(wrapper).getComponent(VListItem).props('disabled')).toBe(
        true
      );
      expect(
        action(wrapper).getComponent(ReasonedAction).props('reason')
      ).toMatch(/configuration disables/);
      expect(getOCTLayoutReason('oct')).toMatch(
        type === '2D' ? /2D slice/ : /En face/
      );
      expect(applyOCTLayout('oct')).toBe(false);
      expect(views.visibleLayout).toBe(previousLayout);
    }
  );

  it('rejects a loaded radial scan without changing the layout', async () => {
    await loadFixture('radial', { scanPattern: '128282' });
    focusImage('radial');
    const views = useViewStore();
    const previousLayout = views.visibleLayout;
    const wrapper = mountSelector();
    expect(
      action(wrapper).getComponent(ReasonedAction).props('reason')
    ).toMatch(/reconstruction/);
    expect(applyOCTLayout('radial')).toBe(false);
    expect(views.visibleLayout).toBe(previousLayout);
  });

  it('preserves matching view ids, slice and projection settings on reselection', async () => {
    await loadFixture('oct');
    focusImage('oct');
    expect(applyOCTLayout('oct')).toBe(true);
    const views = useViewStore();
    const [source, enface] = views.visibleViews;
    const ids = views.visibleViews.map(({ id }) => id);
    const projection = useOCTViewStore().configFor(enface.id, 'oct');
    Object.assign(projection, {
      method: 'max',
      depthStart: 7,
      depthEnd: 19,
      thresholdMicrons: 31.5,
    });
    useViewSliceStore().updateConfig(source.id, 'oct', { slice: 9 });
    views.setActiveView(enface.id);
    expect(applyOCTLayout('oct')).toBe(true);
    expect(views.visibleViews.map(({ id }) => id)).toEqual(ids);
    expect(views.activeView).toBe(enface.id);
    expect(useOCTViewStore().configFor(enface.id, 'oct')).toBe(projection);
    expect(projection).toMatchObject({
      method: 'max',
      depthStart: 7,
      depthEnd: 19,
      thresholdMicrons: 31.5,
    });
    expect(useViewSliceStore().getConfig(source.id, 'oct').slice).toBe(9);
  });
});
