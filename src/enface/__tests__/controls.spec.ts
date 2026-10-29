import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { computed, defineComponent, h, nextTick, reactive, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { CurrentImageInjectionKey } from '@/src/composables/useCurrentImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useEnFaceInput } from '@/src/enface/useEnFaceInput';
import { useEnFaceOccupiedDepth } from '@/src/enface/useEnFaceOccupiedDepth';
import { createVuetify } from 'vuetify';
import EnFaceControls from '@/src/enface/EnFaceControls.vue';
import {
  defaultEnFaceViewConfig,
  useEnFaceViewStore,
  type EnFaceViewConfig,
  type ThicknessControlState,
} from '@/src/enface/store';
import ReasonedAction from '@/src/components/ReasonedAction.vue';

beforeEach(() => {
  vi.stubGlobal('visualViewport', null);
});
afterEach(() => vi.unstubAllGlobals());
enableAutoUnmount(afterEach);

function mountControls(overrides = {}) {
  const settings = reactive({
    ...defaultEnFaceViewConfig(),
    highlightThin: true,
    selectedSegmentId: 'retina',
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
      depthMaximum: 221,
      projectionReason: null,
      thickness: {
        thresholdMaximum: 200,
        segmentationReason: null,
        highlightReason: null,
        thicknessReason: null,
        segments: [
          { value: 'retina', title: 'Retinal layer', color: '#ff0000' },
        ],
      },
    },
    global: { plugins: [createVuetify()] },
  });
}

function lastPatch(wrapper: ReturnType<typeof mountControls>) {
  return wrapper.emitted('patch')?.at(-1)?.[0];
}

function setThickness(
  wrapper: ReturnType<typeof mountControls>,
  thickness: Partial<ThicknessControlState>
) {
  return wrapper.setProps({
    thickness: { ...wrapper.props('thickness'), ...thickness },
  });
}

describe('En face rendering controls', () => {
  it('starts both sections expanded and collapses them independently', async () => {
    const wrapper = mountControls();
    for (const section of ['projection', 'thickness']) {
      expect(
        wrapper
          .get(`[data-testid="enface-${section}-toggle"]`)
          .attributes('aria-expanded')
      ).toBe('true');
    }
    expect(
      wrapper.find('[data-testid="enface-segmentation-segment"] input').exists()
    ).toBe(true);
    expect(
      wrapper
        .find('[data-testid="enface-thickness-threshold-input"] input')
        .exists()
    ).toBe(true);
    expect(wrapper.find('[data-testid="enface-window-width"]').exists()).toBe(
      false
    );
    expect(
      wrapper.get('[data-testid="enface-projection-method"] input').element
    ).toBeDefined();
    expect(
      wrapper
        .get('[data-testid="enface-thin-highlight"]')
        .element.compareDocumentPosition(
          wrapper.get('[data-testid="enface-segmentation-segment"]').element
        ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    const projection = wrapper.get('[data-testid="enface-projection-toggle"]');
    const thickness = wrapper.get('[data-testid="enface-thickness-toggle"]');
    await projection.trigger('click');
    expect(projection.attributes('aria-expanded')).toBe('false');
    expect(thickness.attributes('aria-expanded')).toBe('true');
    await thickness.trigger('click');
    await projection.trigger('click');
    expect(projection.attributes('aria-expanded')).toBe('true');
    expect(thickness.attributes('aria-expanded')).toBe('false');
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

  it('shows segment colors in the selected segment and its dropdown options', async () => {
    const wrapper = mountControls();
    const swatch = () => wrapper.get('[data-testid="enface-segment-color"]');
    expect(swatch().attributes('style')).toContain('background-color: #ff0000');
    await wrapper.setProps({
      thickness: {
        ...wrapper.props('thickness'),
        segments: [
          { value: 'retina', title: 'Retinal layer', color: '#ff0000' },
          { value: 'other-layer', title: 'Other layer', color: '#00ff00' },
        ],
      },
      settings: {
        ...wrapper.props('settings'),
        selectedSegmentId: 'other-layer',
      },
    });
    expect(swatch().attributes('style')).toContain('background-color: #00ff00');
    expect(
      wrapper.get('[data-testid="enface-segmentation-segment"]').text()
    ).toContain('Other layer');
    await wrapper
      .get('[data-testid="enface-segmentation-segment"] input')
      .trigger('keydown', { key: 'Enter' });
    await vi.waitFor(() => {
      const options = document.body.querySelectorAll('[role="option"]');
      expect(options).toHaveLength(2);
      for (const [index, [name, color]] of [
        ['Retinal layer', '#ff0000'],
        ['Other layer', '#00ff00'],
      ].entries()) {
        expect(options[index].textContent).toContain(name);
        expect(
          options[index]
            .querySelector('[data-testid="enface-segment-option-color"]')
            ?.getAttribute('style')
        ).toContain(`background-color: ${color}`);
      }
    });
    (
      document.body.querySelectorAll('[role="option"]')[0] as HTMLElement
    ).click();
    await nextTick();
    expect(lastPatch(wrapper)).toEqual({ selectedSegmentId: 'retina' });
    expect(
      wrapper
        .get('[data-testid="enface-thin-highlight"]')
        .find('.color-dot')
        .exists()
    ).toBe(false);
    expect(
      wrapper.get('[data-testid="enface-thin-highlight"]').text()
    ).toContain('Highlight thin regions');
    await setThickness(wrapper, { segments: [] });
    expect(wrapper.find('[data-testid="enface-segment-color"]').exists()).toBe(
      false
    );
  });
  it('preserves a decimal micron threshold and ignores a cleared numeric entry', async () => {
    const wrapper = mountControls();
    const input = wrapper.get(
      '[data-testid="enface-thickness-threshold-input"] input'
    );
    await input.setValue('20.8');
    expect(lastPatch(wrapper)).toEqual({ thresholdMicrons: 20.8 });
    expect(
      wrapper
        .get('[data-testid="enface-thickness-threshold"] [role="slider"]')
        .attributes('aria-valuenow')
    ).toBe('20.8');
    const previousCount = wrapper.emitted('patch')!.length;
    await input.setValue('');
    expect(wrapper.emitted('patch')).toHaveLength(previousCount);
  });

  it('keeps the threshold slider range fixed while preserving larger numeric thresholds', async () => {
    const wrapper = mountControls();
    const slider = wrapper.get(
      '[data-testid="enface-thickness-threshold"] [role="slider"]'
    );
    expect(slider.attributes('aria-label')).toBe(
      'Thickness threshold in micrometers'
    );
    expect(slider.attributes('aria-valuemax')).toBe('200');
    await slider.trigger('keydown', { key: 'ArrowRight' });
    expect(lastPatch(wrapper)).toEqual({ thresholdMicrons: 100.1 });
    expect(
      wrapper.get<HTMLInputElement>(
        '[data-testid="enface-thickness-threshold-input"] input'
      ).element.value
    ).toBe(slider.attributes('aria-valuenow'));
    for (const [key, expected] of [
      ['Home', 0],
      ['End', 200],
    ] as const) {
      await slider.trigger('keydown', { key });
      expect(lastPatch(wrapper)).toEqual({ thresholdMicrons: expected });
    }
    await wrapper
      .get<HTMLInputElement>(
        '[data-testid="enface-thickness-threshold-input"] input'
      )
      .setValue('750.25');
    expect(lastPatch(wrapper)).toEqual({ thresholdMicrons: 750.25 });
    expect(slider.attributes('aria-valuemax')).toBe('200');
    expect(slider.attributes('aria-valuenow')).toBe('200');
    expect(
      wrapper.get<HTMLInputElement>(
        '[data-testid="enface-thickness-threshold-input"] input'
      ).element.value
    ).toBe('750.25');
    await setThickness(wrapper, { thresholdMaximum: 50 });
    expect(slider.attributes('aria-valuemax')).toBe('50');
    expect(slider.attributes('aria-valuenow')).toBe('50');
    expect(
      wrapper.get<HTMLInputElement>(
        '[data-testid="enface-thickness-threshold-input"] input'
      ).element.value
    ).toBe('750.25');
  });

  it('keeps thickness actions disabled when the selected axis has unusable spacing', async () => {
    const wrapper = mountControls();
    const reason = 'The selected image axis has unusable voxel spacing.';
    await setThickness(wrapper, {
      highlightReason: reason,
      thicknessReason: reason,
    });
    expect(
      wrapper
        .get('[data-testid="enface-segmentation-segment"] input')
        .attributes('disabled')
    ).toBeUndefined();
    expect(
      wrapper
        .get('[data-testid="enface-thin-highlight"] input')
        .attributes('disabled')
    ).toBeDefined();
    const slider = wrapper.get(
      '[data-testid="enface-thickness-threshold"] [role="slider"]'
    );
    expect(slider.attributes('aria-label')).toBe(
      'Thickness threshold in micrometers'
    );
    expect(slider.attributes('tabindex')).toBe('-1');
    await slider.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('patch')).toBeUndefined();
    const action = wrapper
      .findAllComponents(ReasonedAction)
      .find((candidate) =>
        candidate.find('[data-testid="enface-thin-highlight"]').exists()
      );
    expect(action?.props('reason')).toBe(reason);
  });

  it('explains occupied-mask thickness and its user threshold on keyboard focus', async () => {
    const wrapper = mountControls();
    expect(
      wrapper.get('[data-testid="enface-segmentation-segment"]').text()
    ).toContain('Thickness segment');
    const help = wrapper.get<HTMLButtonElement>(
      '[data-testid="enface-thickness-help"]'
    );
    help.element.focus();
    expect(document.activeElement).toBe(help.element);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        'Thickness of the selected segment within the slab, along the projection axis.'
      );
    });
  });

  it('keeps slab help on its information button while leaving the range free of hover tooltips', async () => {
    const wrapper = mountControls();
    await nextTick();
    const range = wrapper.get('[data-testid="enface-slab-range"]');
    expect(range.attributes('aria-describedby')).toBeUndefined();
    const help = range.get<HTMLButtonElement>(
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
  it('keeps unavailable thickness controls visible and exposes the reason through their wrapper', async () => {
    const wrapper = mountControls();
    const toggle = wrapper.get('[data-testid="enface-thin-highlight"] input');
    const segment = wrapper.get(
      '[data-testid="enface-segmentation-segment"] input'
    );
    await toggle.setValue(false);
    expect(segment.attributes('disabled')).toBeUndefined();
    const segmentAction = wrapper
      .findAllComponents(ReasonedAction)
      .find((action) =>
        action.find('[data-testid="enface-segmentation-segment"]').exists()
      );
    expect(segmentAction?.props('reason')).toBeUndefined();
    await setThickness(wrapper, {
      thicknessReason: 'The selected segment is hidden.',
    });
    expect(toggle.attributes('disabled')).toBeUndefined();
    await toggle.setValue(true);
    expect(segment.attributes('disabled')).toBeUndefined();
    const reason = 'Load an associated segmentation to measure thickness.';
    await setThickness(wrapper, {
      segments: [],
      segmentationReason: reason,
      highlightReason: reason,
      thicknessReason: reason,
    });
    expect(
      wrapper
        .get('[data-testid="enface-thin-highlight"] input')
        .attributes('disabled')
    ).toBeDefined();
    expect(
      wrapper
        .get<HTMLInputElement>(
          '[data-testid="enface-thickness-threshold-input"] input'
        )
        .attributes('disabled')
    ).toBeDefined();
    const thresholdAction = wrapper
      .findAllComponents(ReasonedAction)
      .find((action) =>
        action.find('[data-testid="enface-thickness-threshold-input"]').exists()
      );
    expect(thresholdAction?.props('reason')).toBe(reason);
    expect(thresholdAction?.attributes('tabindex')).toBe('0');
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
  const component = defineComponent({
    setup() {
      const input = useEnFaceInput('measurement-view');
      const thickness = useEnFaceOccupiedDepth('measurement-view', {
        source: input.source,
        slab: input.specification,
        geometry: input.geometry,
        blockedReason: computed(() => input.controls.value.projectionReason),
      });
      const enFaceStore = useEnFaceViewStore();
      return () =>
        h(EnFaceControls, {
          ...input.controls.value,
          settings: enFaceStore.settingsFor(
            'measurement-view',
            input.source.currentImageID.value
          ),
          thickness: thickness.controls.value,
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
            .get('[data-testid="enface-thin-highlight"] input')
            .attributes('disabled')
        ).toBeUndefined();
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
            .get('[data-testid="enface-thin-highlight"] input')
            .attributes('disabled')
        ).toBeDefined();
        const action = wrapper
          .get('[data-testid="enface-thin-highlight"]')
          .element.closest<HTMLElement>('[tabindex="0"]');
        expect(action).not.toBeNull();
        action!.focus();
        await vi.waitFor(() => {
          expect(document.body.textContent).toContain(
            'The projection axis has invalid voxel spacing'
          );
        });
      } finally {
        wrapper.unmount();
        dispose();
      }
    }
  );
});
