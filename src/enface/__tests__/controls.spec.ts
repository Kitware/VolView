import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, reactive, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { CurrentImageInjectionKey } from '@/src/composables/useCurrentImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useEnFaceInput } from '@/src/enface/useEnFaceInput';
import { useThinCalibration } from '@/src/enface/useThinCalibration';
import { createVuetify } from 'vuetify';
import EnFaceControls from '@/src/enface/EnFaceControls.vue';
import {
  defaultEnFaceViewConfig,
  defaultSegmentProjection,
  useEnFaceViewStore,
  type EnFaceViewConfig,
  type SegmentControlState,
  type SegmentProjection,
} from '@/src/enface/store';

beforeEach(() => {
  vi.stubGlobal('visualViewport', null);
});
afterEach(() => vi.unstubAllGlobals());
enableAutoUnmount(afterEach);

const thin = { visible: true, thresholdMicrons: 100 };
const names = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `segment-${index}`,
    title: `Segment ${index}`,
    listHidden: false,
    thresholdMaximum: 200,
  }));

function mountControls(overrides: Partial<EnFaceViewConfig> = {}) {
  const settings = reactive({
    ...defaultEnFaceViewConfig(),
    segmentProjections: { retina: { ...thin } },
    ...overrides,
  });
  return mount(EnFaceControls, {
    attachTo: document.body,
    props: {
      settings,
      axes: [
        { title: 'Axial', value: 2 },
        { title: 'Coronal', value: 1 },
        { title: 'Sagittal', value: 0 },
      ],
      onPatch: (patch: Partial<EnFaceViewConfig>) =>
        Object.assign(settings, patch),
      onSegment: (id: string, patch: Partial<SegmentProjection>) => {
        settings.segmentProjections[id] = {
          ...defaultSegmentProjection(),
          ...settings.segmentProjections[id],
          ...patch,
        };
      },
      depthMaximum: 221,
      projectionReason: null,
      segmentControls: {
        segments: [
          {
            id: 'retina',
            title: 'Retinal layer',
            color: '#ff0000',
            listHidden: false,
            thresholdMaximum: 200,
          },
        ],
        segmentationReason: null,
        thinReason: null,
      },
    },
    global: { plugins: [createVuetify()] },
  });
}

function lastPatch(wrapper: ReturnType<typeof mountControls>) {
  return wrapper.emitted('patch')?.at(-1)?.[0];
}

function lastSegmentPatch(wrapper: ReturnType<typeof mountControls>) {
  return wrapper.emitted('segment')?.at(-1);
}

function setSegmentControls(
  wrapper: ReturnType<typeof mountControls>,
  controls: Partial<SegmentControlState>
) {
  return wrapper.setProps({
    segmentControls: { ...wrapper.props('segmentControls'), ...controls },
  });
}

const rowNames = (wrapper: ReturnType<typeof mountControls>) =>
  wrapper
    .findAll('[data-testid="enface-segment-row"]')
    .map((row) => row.attributes('data-segment-name'));

describe('En face rendering controls', () => {
  it('starts both sections expanded and collapses them independently', async () => {
    const wrapper = mountControls();
    const projection = wrapper.get('[data-testid="enface-projection-toggle"]');
    const segments = wrapper.get('[data-testid="enface-segments-toggle"]');
    expect(projection.attributes('aria-expanded')).toBe('true');
    expect(segments.attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('[data-testid="enface-segment-row"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-testid="enface-window-width"]').exists()).toBe(
      false
    );
    await projection.trigger('click');
    expect(projection.attributes('aria-expanded')).toBe('false');
    expect(segments.attributes('aria-expanded')).toBe('true');
    await segments.trigger('click');
    await projection.trigger('click');
    expect(projection.attributes('aria-expanded')).toBe('true');
    expect(segments.attributes('aria-expanded')).toBe('false');
  });

  it('preserves saved projection settings when collapsed and reopened', async () => {
    const saved = {
      axis: 2 as const,
      depthStart: 100,
      depthEnd: 103,
      method: 'sum' as const,
    };
    const wrapper = mountControls(saved);
    const toggle = wrapper.get('[data-testid="enface-projection-toggle"]');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(
      wrapper.findAll('[data-testid="enface-projection-axis"]')
    ).toHaveLength(1);
    expect(
      wrapper.get<HTMLInputElement>(
        '[data-testid="enface-projection-axis"] input'
      ).element.value
    ).toBe('Axial');
    expect(
      wrapper.get<HTMLInputElement>(
        '[data-testid="enface-projection-method"] input'
      ).element.value
    ).toBe('Sum');
    expect(
      wrapper.get('[aria-label="Slab start"]').attributes('aria-valuenow')
    ).toBe('100');
    expect(
      wrapper.get('[aria-label="Slab end"]').attributes('aria-valuenow')
    ).toBe('103');
    expect(wrapper.emitted('patch')).toBeUndefined();
  });

  it('lists every segment hidden by default and shows each with its eye', async () => {
    const wrapper = mountControls({ segmentProjections: {} });
    await setSegmentControls(wrapper, {
      segments: [
        {
          id: 'retina',
          title: 'Retinal layer',
          color: '#ff0000',
          listHidden: false,
          thresholdMaximum: 200,
        },
        {
          id: 'other',
          title: 'Other layer',
          listHidden: false,
          thresholdMaximum: 200,
        },
      ],
    });
    expect(rowNames(wrapper)).toEqual(['Retinal layer', 'Other layer']);
    expect(
      wrapper.get('[data-testid="enface-segment-color"]').attributes('style')
    ).toContain('background-color: #ff0000');
    const eyes = wrapper.findAll('[data-testid="enface-segment-visible"]');
    expect(eyes.map((eye) => eye.attributes('aria-pressed'))).toEqual([
      'false',
      'false',
    ]);
    expect(
      wrapper.find('[data-testid="enface-segment-threshold"]').exists()
    ).toBe(false);
    await eyes[1].trigger('click');
    expect(lastSegmentPatch(wrapper)).toEqual(['other', { visible: true }]);
    expect(eyes[1].attributes('aria-pressed')).toBe('true');
    expect(eyes[0].attributes('aria-pressed')).toBe('false');
    const input = wrapper.get<HTMLInputElement>(
      '[data-testid="enface-segment-threshold-input"] input'
    );
    expect(input.element.value).toBe('');
    expect(input.attributes('placeholder')).toBe('Any');
    await eyes[1].trigger('click');
    expect(lastSegmentPatch(wrapper)).toEqual(['other', { visible: false }]);
    expect(
      wrapper.find('[data-testid="enface-segment-threshold"]').exists()
    ).toBe(false);
  });

  it('shows or hides every segment from the section header', async () => {
    const wrapper = mountControls({
      segmentProjections: { 'segment-1': { ...thin } },
    });
    await setSegmentControls(wrapper, { segments: names(3) });
    const all = wrapper.get('[data-testid="enface-segments-visible"]');
    expect(all.attributes('aria-label')).toBe('Show every segment');
    await all.trigger('click');
    const pressed = () =>
      wrapper
        .findAll('[data-testid="enface-segment-visible"]')
        .map((eye) => eye.attributes('aria-pressed'));
    expect(pressed()).toEqual(['true', 'true', 'true']);
    expect(all.attributes('aria-label')).toBe('Hide every segment');
    await all.trigger('click');
    expect(pressed()).toEqual(['false', 'false', 'false']);
  });

  it('turns the thin filter on below the slider end and off at it', async () => {
    const wrapper = mountControls({
      segmentProjections: { retina: { visible: true, thresholdMicrons: null } },
    });
    const slider = wrapper.get(
      '[data-testid="enface-segment-threshold"] [role="slider"]'
    );
    const input = wrapper.get<HTMLInputElement>(
      '[data-testid="enface-segment-threshold-input"] input'
    );
    expect(slider.attributes('aria-valuenow')).toBe('200');
    await slider.trigger('keydown', { key: 'Home' });
    expect(lastSegmentPatch(wrapper)).toEqual([
      'retina',
      { thresholdMicrons: 0 },
    ]);
    expect(input.element.value).toBe('0');
    await slider.trigger('keydown', { key: 'End' });
    expect(lastSegmentPatch(wrapper)).toEqual([
      'retina',
      { thresholdMicrons: null },
    ]);
    expect(input.element.value).toBe('');
    await input.setValue('42');
    expect(lastSegmentPatch(wrapper)).toEqual([
      'retina',
      { thresholdMicrons: 42 },
    ]);
    await input.setValue('');
    expect(lastSegmentPatch(wrapper)).toEqual([
      'retina',
      { thresholdMicrons: null },
    ]);
  });

  it('keeps a separate threshold for each thin-highlighted segment', async () => {
    const wrapper = mountControls({
      segmentProjections: {
        'segment-0': { ...thin },
        'segment-1': { ...thin, thresholdMicrons: 40 },
      },
    });
    await setSegmentControls(wrapper, { segments: names(2) });
    const inputs = wrapper.findAll<HTMLInputElement>(
      '[data-testid="enface-segment-threshold-input"] input'
    );
    expect(inputs.map((input) => input.element.value)).toEqual(['100', '40']);
    await inputs[1].setValue('55.5');
    expect(lastSegmentPatch(wrapper)).toEqual([
      'segment-1',
      { thresholdMicrons: 55.5 },
    ]);
    expect(inputs[0].element.value).toBe('100');
  });

  it('preserves a decimal micron threshold', async () => {
    const wrapper = mountControls();
    const input = wrapper.get(
      '[data-testid="enface-segment-threshold-input"] input'
    );
    await input.setValue('20.8');
    expect(lastSegmentPatch(wrapper)).toEqual([
      'retina',
      { thresholdMicrons: 20.8 },
    ]);
    expect(
      wrapper
        .get('[data-testid="enface-segment-threshold"] [role="slider"]')
        .attributes('aria-valuenow')
    ).toBe('20.8');
  });

  it('keeps the threshold slider range fixed while preserving larger numeric thresholds', async () => {
    const wrapper = mountControls();
    const slider = wrapper.get(
      '[data-testid="enface-segment-threshold"] [role="slider"]'
    );
    const input = wrapper.get<HTMLInputElement>(
      '[data-testid="enface-segment-threshold-input"] input'
    );
    expect(slider.attributes('aria-label')).toBe(
      'Thickness threshold of Retinal layer in micrometers'
    );
    expect(slider.attributes('aria-valuemax')).toBe('200');
    await slider.trigger('keydown', { key: 'ArrowRight' });
    expect(lastSegmentPatch(wrapper)).toEqual([
      'retina',
      { thresholdMicrons: 100.1 },
    ]);
    expect(input.element.value).toBe(slider.attributes('aria-valuenow'));
    await input.setValue('750.25');
    expect(slider.attributes('aria-valuemax')).toBe('200');
    expect(slider.attributes('aria-valuenow')).toBe('200');
    expect(input.element.value).toBe('750.25');
    await setSegmentControls(wrapper, {
      segments: [
        {
          id: 'retina',
          title: 'Retinal layer',
          listHidden: false,
          thresholdMaximum: 50,
        },
      ],
    });
    expect(slider.attributes('aria-valuemax')).toBe('50');
    expect(slider.attributes('aria-valuenow')).toBe('50');
    expect(input.element.value).toBe('750.25');
  });

  it('explains why thickness filtering is unavailable while the eye stays usable', async () => {
    const wrapper = mountControls();
    const reason = 'The selected image axis has unusable voxel spacing.';
    await setSegmentControls(wrapper, { thinReason: reason });
    expect(wrapper.get('[data-testid="enface-thin-reason"]').text()).toBe(
      `Thickness filtering is unavailable. ${reason}`
    );
    expect(
      wrapper
        .get('[data-testid="enface-segment-visible"]')
        .attributes('disabled')
    ).toBeUndefined();
    expect(
      wrapper.find('[data-testid="enface-segment-threshold"]').exists()
    ).toBe(false);
  });

  it('leaves segments hidden in the Annotations list out of en face eyes, keeping their settings', async () => {
    const wrapper = mountControls();
    const retina = {
      id: 'retina',
      title: 'Retinal layer',
      color: '#ff0000',
      thresholdMaximum: 200,
    };
    const other = { id: 'other', title: 'Other layer', thresholdMaximum: 200 };
    const eye = (name: string) =>
      wrapper.get(
        `[data-segment-name="${name}"] [data-testid="enface-segment-visible"]`
      );
    const threshold = () =>
      wrapper.find<HTMLInputElement>(
        '[data-testid="enface-segment-threshold-input"] input'
      );
    const all = () => wrapper.get('[data-testid="enface-segments-visible"]');
    await setSegmentControls(wrapper, {
      segments: [
        { ...retina, listHidden: true },
        { ...other, listHidden: true },
      ],
    });
    expect(eye('Retinal layer').attributes('disabled')).toBeDefined();
    expect(eye('Retinal layer').attributes('aria-pressed')).toBe('false');
    expect(eye('Retinal layer').find('.mdi-eye-off').exists()).toBe(true);
    expect(threshold().exists()).toBe(false);
    expect(all().attributes('disabled')).toBeDefined();

    await setSegmentControls(wrapper, {
      segments: [
        { ...retina, listHidden: true },
        { ...other, listHidden: false },
      ],
    });
    expect(all().attributes('aria-label')).toBe('Show every segment');
    await all().trigger('click');
    expect(eye('Other layer').attributes('aria-pressed')).toBe('true');
    expect(all().attributes('aria-label')).toBe('Hide every segment');
    await all().trigger('click');
    expect(eye('Other layer').attributes('aria-pressed')).toBe('false');

    await setSegmentControls(wrapper, {
      segments: [
        { ...retina, listHidden: false },
        { ...other, listHidden: false },
      ],
    });
    expect(eye('Retinal layer').attributes('disabled')).toBeUndefined();
    expect(eye('Retinal layer').attributes('aria-pressed')).toBe('true');
    expect(threshold().element.value).toBe('100');
  });

  it('keeps the threshold field usable while the slider waits for a measurement', async () => {
    const wrapper = mountControls();
    await setSegmentControls(wrapper, {
      segments: [
        {
          id: 'retina',
          title: 'Retinal layer',
          listHidden: false,
          thresholdMaximum: null,
        },
      ],
    });
    const slider = wrapper.get(
      '[data-testid="enface-segment-threshold"] [role="slider"]'
    );
    expect(slider.attributes('tabindex')).toBe('-1');
    await slider.trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.emitted('segment')).toBeUndefined();
    await wrapper
      .get('[data-testid="enface-segment-threshold-input"] input')
      .setValue('42');
    expect(lastSegmentPatch(wrapper)).toEqual([
      'retina',
      { thresholdMicrons: 42 },
    ]);
  });

  it('keeps segment rows listed but disabled while the projection is unavailable', async () => {
    const wrapper = mountControls();
    const reason = 'The volume is still loading.';
    await setSegmentControls(wrapper, { segmentationReason: reason });
    expect(wrapper.get('[data-testid="enface-segments-reason"]').text()).toBe(
      reason
    );
    expect(rowNames(wrapper)).toEqual(['Retinal layer']);
    expect(
      wrapper
        .get('[data-testid="enface-segment-visible"]')
        .attributes('disabled')
    ).toBeDefined();
    expect(
      wrapper.find('[data-testid="enface-segment-threshold"]').exists()
    ).toBe(false);
  });

  it('explains why no segments are listed', async () => {
    const wrapper = mountControls();
    const reason =
      'Load or create a segmentation mask associated with this volume.';
    await setSegmentControls(wrapper, {
      segments: [],
      segmentationReason: reason,
    });
    expect(wrapper.get('[data-testid="enface-segments-reason"]').text()).toBe(
      reason
    );
    expect(wrapper.find('[data-testid="enface-segment-row"]').exists()).toBe(
      false
    );
  });

  it('keeps slab help on its information button while leaving the range free of hover tooltips', async () => {
    const wrapper = mountControls();
    await nextTick();
    const range = wrapper.get('[data-testid="enface-slab-range"]');
    expect(range.attributes('aria-describedby')).toBeUndefined();
    const help = wrapper.get<HTMLButtonElement>(
      '[data-testid="enface-slab-help"]'
    );
    expect(help.attributes('aria-label')).toBe('About slab range');
    help.element.focus();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        'First and last voxel indices along the chosen axis, both included in the projection.'
      );
    });
  });

  it('adjusts inclusive slab bounds with two named keyboard-operated thumbs', async () => {
    const wrapper = mountControls({ depthStart: 100, depthEnd: 221 });
    const range = wrapper.get('[data-testid="enface-slab-range"]');
    const start = range.get('[role="slider"][aria-label="Slab start"]');
    const end = range.get('[role="slider"][aria-label="Slab end"]');
    expect(start.attributes('aria-valuenow')).toBe('100');
    expect(end.attributes('aria-valuenow')).toBe('221');
    await end.trigger('keydown', { key: 'Home' });
    expect(lastPatch(wrapper)).toEqual({ depthStart: 100, depthEnd: 100 });
    await start.trigger('keydown', { key: 'ArrowRight' });
    expect(start.attributes('aria-valuenow')).toBe('100');
    await start.trigger('keydown', { key: 'Home' });
    expect(lastPatch(wrapper)).toEqual({ depthStart: 0, depthEnd: 100 });
    await end.trigger('keydown', { key: 'End' });
    expect(lastPatch(wrapper)).toEqual({ depthStart: 0, depthEnd: 221 });
    expect(range.text()).toContain('0');
    expect(range.text()).toContain('221');
    await wrapper.setProps({ depthMaximum: 0 });
    expect(start.attributes('aria-valuenow')).toBe('0');
    expect(end.attributes('aria-valuenow')).toBe('0');
    await end.trigger('keydown', { key: 'End' });
    expect(start.attributes('aria-valuenow')).toBe('0');
    expect(end.attributes('aria-valuenow')).toBe('0');
  });

  it('commits the last rounded pointer position when release crosses a step', async () => {
    const wrapper = mountControls({ depthStart: 10, depthEnd: 200 });
    const range = wrapper.get('[data-testid="enface-slab-range"]');
    const track = range.get('.v-slider-track').element;
    const end = range.get('[role="slider"][aria-label="Slab end"]');
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 221, 10)
    );
    vi.spyOn(end.element, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(190, 0, 20, 10)
    );
    await end.trigger('mousedown', { button: 0, clientX: 200, clientY: 5 });
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 180.4 }));
    await nextTick();
    expect(end.attributes('aria-valuenow')).toBe('180');
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 180.6 }));
    await nextTick();
    expect(end.attributes('aria-valuenow')).toBe('181');
    expect(range.text()).toContain('181');
  });
});

function mountImageControls(spacing = 0.01) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const source = vtkImageData.newInstance();
  source.setDimensions([2, 2, 2]);
  source.setSpacing([0.03, spacing, 0.2]);
  source
    .getPointData()
    .setScalars(
      vtkDataArray.newInstance({ values: new Uint8Array(8).fill(1) })
    );
  const cache = useImageCacheStore();
  const imageId = cache.addVTKImageData(source, 'relative-spacing.vti');
  const segmentation = useSegmentationStore();
  const segmentId = useSegmentStore().segments.addSegment({ name: 'Retina' });
  const mask = segmentation.createMask(
    segmentation.ensureSegmentationForImage(imageId).id,
    segmentId
  );
  const voxels = segmentation.maskVoxels(mask.id);
  voxels.materialize();
  voxels.ensureContains([0, 1, 0, 1, 0, 1]);
  voxels.apply(new Uint8Array(8).fill(1));
  useEnFaceViewStore().configFor(
    'measurement-view',
    imageId
  ).segmentProjections[segmentId] = {
    ...defaultSegmentProjection(),
    visible: true,
  };
  const component = defineComponent({
    setup() {
      const input = useEnFaceInput('measurement-view');
      const calibration = useThinCalibration(input.source, input.specification);
      const enFaceStore = useEnFaceViewStore();
      return () =>
        h(EnFaceControls, {
          ...input.controls.value,
          settings: enFaceStore.settingsFor(
            'measurement-view',
            input.source.currentImageID.value
          ),
          segmentControls: {
            segments: [
              {
                id: segmentId,
                title: 'Retina',
                listHidden: false,
                thresholdMaximum: 1,
              },
            ],
            segmentationReason: null,
            thinReason: calibration.reason.value,
          },
        });
    },
  });
  const wrapper = mount(component, {
    attachTo: document.body,
    global: {
      plugins: [pinia, createVuetify()],
      provide: {
        [CurrentImageInjectionKey as symbol]: { imageID: ref(imageId) },
      },
    },
  });
  return { source, wrapper, dispose: () => cache.removeImage(imageId) };
}

describe('thickness control geometry', () => {
  it.each([0.01, -0.01])(
    'allows loaded spacing %f without a separate physical-unit declaration',
    (spacing) => {
      const { wrapper, dispose } = mountImageControls(spacing);
      try {
        expect(
          wrapper
            .find('[data-testid="enface-segment-threshold-input"]')
            .exists()
        ).toBe(true);
      } finally {
        wrapper.unmount();
        dispose();
      }
    }
  );

  it.each([0, NaN, Infinity])(
    'disables thickness controls after the projection axis spacing becomes %s',
    async (spacing) => {
      const { source, wrapper, dispose } = mountImageControls();
      try {
        source.setSpacing([0.03, spacing, 0.2]);
        await nextTick();
        expect(
          wrapper
            .find('[data-testid="enface-segment-threshold-input"]')
            .exists()
        ).toBe(false);
        expect(
          wrapper.get('[data-testid="enface-thin-reason"]').text()
        ).toContain('The projection axis has invalid voxel spacing');
      } finally {
        wrapper.unmount();
        dispose();
      }
    }
  );
});
