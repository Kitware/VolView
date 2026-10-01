import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { createVuetify } from 'vuetify';
import EnFaceControls from '@/src/oct/EnFaceControls.vue';
import { defaultOCTViewConfig, type OCTViewConfig } from '@/src/oct/store';
import ReasonedAction from '@/src/components/ReasonedAction.vue';

enableAutoUnmount(afterEach);

function mountControls(overrides = {}) {
  const settings = reactive({
    ...defaultOCTViewConfig(),
    highlightThin: true,
    selectedMaskId: 'retina',
    ...overrides,
  });
  return mount(EnFaceControls, {
    attachTo: document.body,
    props: {
      settings,
      onPatch: (patch: Partial<OCTViewConfig>) =>
        Object.assign(settings, patch),
      depthMaximum: 221,
      projectionReason: null,
      segmentationReason: null,
      thicknessReason: null,
      segments: [{ value: 'retina', title: 'Retinal layer' }],
    },
    global: { plugins: [createVuetify()] },
  });
}

async function openAdvanced(wrapper: ReturnType<typeof mountControls>) {
  await wrapper.get('[data-testid="oct-advanced-toggle"]').trigger('click');
}

function lastPatch(wrapper: ReturnType<typeof mountControls>) {
  return wrapper.emitted('patch')?.at(-1)?.[0];
}

describe('En face rendering controls', () => {
  it('keeps advanced projection settings collapsed while showing the thickness controls', async () => {
    const wrapper = mountControls();
    expect(
      wrapper.find('[data-testid="oct-segmentation-segment"] input').exists()
    ).toBe(true);
    expect(
      wrapper
        .find('[data-testid="oct-thickness-threshold-input"] input')
        .exists()
    ).toBe(true);
    expect(wrapper.find('[data-testid="oct-projection-method"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-testid="oct-window-width"]').exists()).toBe(
      false
    );
    expect(
      wrapper.find('[data-testid="oct-segmentation-group"]').exists()
    ).toBe(false);
    await openAdvanced(wrapper);
    expect(
      wrapper.get('[data-testid="oct-projection-method"] input').element
    ).toBeDefined();
  });

  it('preserves a decimal micron threshold and ignores a cleared numeric entry', async () => {
    const wrapper = mountControls();
    const input = wrapper.get(
      '[data-testid="oct-thickness-threshold-input"] input'
    );
    await input.setValue('20.8');
    expect(lastPatch(wrapper)).toEqual({ thresholdMicrons: 20.8 });
    expect(
      wrapper
        .get('[data-testid="oct-thickness-threshold"] [role="slider"]')
        .attributes('aria-valuenow')
    ).toBe('20.8');
    const previousCount = wrapper.emitted('patch')!.length;
    await input.setValue('');
    expect(wrapper.emitted('patch')).toHaveLength(previousCount);
  });

  it('keeps slider changes and the micron input synchronized across a 500 micron span', async () => {
    const wrapper = mountControls();
    const slider = wrapper.get(
      '[data-testid="oct-thickness-threshold"] [role="slider"]'
    );
    expect(slider.attributes('aria-valuemax')).toBe('500');
    await slider.trigger('keydown', { key: 'ArrowRight' });
    expect(
      wrapper.get<HTMLInputElement>(
        '[data-testid="oct-thickness-threshold-input"] input'
      ).element.value
    ).toBe(slider.attributes('aria-valuenow'));
    await wrapper
      .get<HTMLInputElement>(
        '[data-testid="oct-thickness-threshold-input"] input'
      )
      .setValue('750.25');
    expect(slider.attributes('aria-valuemax')).toBe('750.25');
    expect(slider.attributes('aria-valuenow')).toBe('750.25');
  });

  it('keeps calibrated thickness actions disabled when the selected axis has no physical spacing', async () => {
    const wrapper = mountControls();
    const reason = 'Physical A-line spacing is unavailable.';
    await wrapper.setProps({ thicknessReason: reason });
    expect(
      wrapper
        .get('[data-testid="oct-segmentation-segment"] input')
        .attributes('disabled')
    ).toBeUndefined();
    expect(
      wrapper
        .get('[data-testid="oct-thin-highlight"] input')
        .attributes('disabled')
    ).toBeDefined();
    const slider = wrapper.get(
      '[data-testid="oct-thickness-threshold"] [role="slider"]'
    );
    await slider.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('patch')).toBeUndefined();
    const action = wrapper
      .findAllComponents(ReasonedAction)
      .find((candidate) =>
        candidate.find('[data-testid="oct-thin-highlight"]').exists()
      );
    expect(action?.props('reason')).toBe(reason);
  });

  it('commits a slab endpoint after typing without lowering the other endpoint', async () => {
    const wrapper = mountControls({ depthStart: 100, depthEnd: 221 });
    await openAdvanced(wrapper);
    const input = wrapper.get('[data-testid="oct-slab-end"] input');
    for (const value of ['1', '10', '103']) {
      (input.element as HTMLInputElement).value = value;
      await input.trigger('input');
    }
    expect(wrapper.emitted('patch')).toBeUndefined();
    await input.trigger('change');
    expect(lastPatch(wrapper)).toEqual({ depthEnd: 103 });
  });

  it('keeps unavailable thickness controls visible and exposes the reason through their wrapper', async () => {
    const wrapper = mountControls();
    const reason = 'Load an associated segmentation to measure thickness.';
    await wrapper.setProps({
      segments: [],
      segmentationReason: reason,
      thicknessReason: reason,
    });
    expect(
      wrapper
        .get('[data-testid="oct-thin-highlight"] input')
        .attributes('disabled')
    ).toBeDefined();
    expect(
      wrapper
        .get<HTMLInputElement>(
          '[data-testid="oct-thickness-threshold-input"] input'
        )
        .attributes('disabled')
    ).toBeDefined();
    const thresholdAction = wrapper
      .findAllComponents(ReasonedAction)
      .find((action) =>
        action.find('[data-testid="oct-thickness-threshold-input"]').exists()
      );
    expect(thresholdAction?.props('reason')).toBe(reason);
    expect(thresholdAction?.attributes('tabindex')).toBe('0');
  });
});
