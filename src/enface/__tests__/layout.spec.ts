import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createVuetify } from 'vuetify';
import { VSelect } from 'vuetify/components';
import { nextTick } from 'vue';
import JSZip from 'jszip';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { MANIFEST, serialize } from '@/src/io/state-file/serialize';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import LayoutSelector from '@/src/components/LayoutSelector.vue';
import ViewTypeSwitcher from '@/src/components/ViewTypeSwitcher.vue';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { useEnFaceViewStore } from '@/src/enface/store';
import { cleanupCachedImages } from '@/tests/unit/imageCacheCleanup';

afterEach(() => vi.unstubAllGlobals());
enableAutoUnmount(afterEach);
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => cleanupCachedImages([]));

async function loadVolume(id: string) {
  const image = vtkImageData.newInstance();
  image.setDimensions(2, 3, 4);
  image
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ values: new Uint16Array(24) }));
  useImageCacheStore().addVTKImageData(image, 'Generic volume', { id });
  await nextTick();
}

function configureComparison() {
  useViewStore().setNamedLayoutsFromConfig({
    Comparison: [['axial'], ['enface']],
  });
}

describe('En face view configuration', () => {
  it.each(['custom', 'named', 'legacy named'])(
    'restores the %s layout selection without inferring its identity from panes',
    async (selection) => {
      await loadVolume('oct');
      const views = useViewStore();
      views.setDataForAllViews('oct');
      configureComparison();
      views.switchToNamedLayout('Comparison');
      if (selection === 'custom') views.setLayoutFromGrid([1, 2]);
      const hidden = views
        .getAllViews()
        .filter((view) => !views.layoutViews.includes(view));
      const saved = await serialize({
        writers: [
          (state) => {
            state.manifest.datasets = [{ id: 'oct', dataSourceId: 1 }];
            state.manifest.dataSources = [
              { id: 1, type: 'uri', uri: '/oct.nrrd' },
            ];
            views.serialize(state);
          },
        ],
        addWarning: () => {},
      });
      const zip = await JSZip.loadAsync(saved);
      const raw = JSON.parse(await zip.file(MANIFEST)!.async('string'));
      if (selection === 'legacy named') delete raw.currentLayoutName;
      const manifest = ManifestSchema.parse(raw);
      await cleanupCachedImages([]);
      setActivePinia(createPinia());
      await loadVolume('restored-oct');
      configureComparison();
      const restored = useViewStore();
      restored.switchToNamedLayout('Comparison');
      restored.deserializeLayout(manifest);
      restored.bindViewsToData('oct', 'restored-oct', manifest);
      expect(
        restored.layoutViews.map(({ type, dataID }) => ({ type, dataID }))
      ).toEqual([
        { type: '2D', dataID: 'restored-oct' },
        { type: 'EnFace', dataID: 'restored-oct' },
      ]);
      hidden.forEach(({ id, type }) =>
        expect(restored.getView(id)?.type).toBe(type)
      );
      const wrapper = mount(LayoutSelector, {
        global: { plugins: [createVuetify()] },
      });
      const named = wrapper.get('.v-list-item');
      expect(named.text()).toBe('Comparison');
      expect(named.classes().includes('v-list-item--active')).toBe(
        selection === 'named'
      );
      expect(Object.keys(restored.namedLayouts)).toEqual(['Comparison']);
    }
  );
  it('keeps configuration-disabled En face visible with its reason and guards selection', async () => {
    vi.stubGlobal('visualViewport', null);
    await loadVolume('oct');
    const views = useViewStore();
    const volume = views.layoutViews.find((view) => view.type === '3D')!;
    views.setDataForView(volume.id, 'oct');
    views.disabledViewTypes = ['EnFace', 'Oblique'];
    await nextTick();
    const ids = views.layoutViews.map(({ id }) => id);
    const wrapper = mount(ViewTypeSwitcher, {
      props: { viewId: volume.id, imageId: 'oct' },
      attachTo: document.body,
      global: { plugins: [createVuetify()] },
    });
    const select = wrapper.getComponent(VSelect);
    const option = () =>
      select.props('items')!.find((item) => item.value === 'En face')!;
    const reason = 'The current configuration disables En face views.';
    expect(option()).toMatchObject({ reason, props: { disabled: true } });
    expect(
      select.props('items')!.some((item) => item.value === 'Oblique')
    ).toBe(false);
    expect(
      views.availableViewsForSwitcher.some((view) => view.type === 'EnFace')
    ).toBe(false);
    await wrapper.get('.v-field').trigger('mousedown');
    const disabledItem = document.querySelector(
      '[title="' + reason + '"] .v-list-item'
    );
    expect(disabledItem).not.toBeNull();
    expect(disabledItem!.classList.contains('v-list-item--disabled')).toBe(
      true
    );
    disabledItem!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    select.vm.$emit('update:modelValue', 'En face');
    await nextTick();
    expect(views.layoutViews.map(({ id }) => id)).toEqual(ids);
    expect(views.getView(volume.id)?.type).toBe('3D');

    views.disabledViewTypes = ['Oblique'];
    await nextTick();
    expect(option()).toMatchObject({
      reason: null,
      props: { disabled: false },
    });
    select.vm.$emit('update:modelValue', 'En face');
    await nextTick();
    expect(
      views.layoutViews.find((view) => view.dataID === 'oct')
    ).toMatchObject({
      type: 'EnFace',
      dataID: 'oct',
    });
  });

  it('preserves matching view ids, slice and projection settings on named layout reselection', async () => {
    await loadVolume('oct');
    const views = useViewStore();
    views.setDataForAllViews('oct');
    configureComparison();
    views.switchToNamedLayout('Comparison');
    const [source, enface] = views.visibleViews;
    const ids = views.visibleViews.map(({ id }) => id);
    const projection = useEnFaceViewStore().configFor(enface.id, 'oct');
    Object.assign(projection, {
      method: 'max',
      depthStart: 1,
      depthEnd: 2,
      thresholdMicrons: 31.5,
    });
    useViewSliceStore().updateConfig(source.id, 'oct', { slice: 2 });
    views.setActiveView(enface.id);
    views.switchToNamedLayout('Comparison');
    expect(views.visibleViews.map(({ id }) => id)).toEqual(ids);
    expect(views.activeView).toBe(enface.id);
    expect(useEnFaceViewStore().configFor(enface.id, 'oct')).toBe(projection);
    expect(projection).toMatchObject({
      method: 'max',
      depthStart: 1,
      depthEnd: 2,
      thresholdMicrons: 31.5,
    });
    expect(useViewSliceStore().getConfig(source.id, 'oct').slice).toBe(2);
  });
});
