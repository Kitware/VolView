import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { createVuetify } from 'vuetify';
import EnFaceControls from '@/src/oct/EnFaceControls.vue';
import { defaultOCTViewConfig, type OCTViewConfig } from '@/src/oct/store';
import ReasonedAction from '@/src/components/ReasonedAction.vue';

beforeEach(() => {
  vi.stubGlobal('visualViewport', null);
});
afterEach(() => vi.unstubAllGlobals());
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
      thresholdMaximum: 200,
      projectionReason: null,
      segmentationReason: null,
      highlightReason: null,
      thicknessReason: null,
      segments: [{ value: 'retina', title: 'Retinal layer', color: '#ff0000' }],
    },
    global: { plugins: [createVuetify()] },
  });
}

function lastPatch(wrapper: ReturnType<typeof mountControls>) {
  return wrapper.emitted('patch')?.at(-1)?.[0];
}

describe('En face rendering controls', () => {
  it('starts both sections expanded and collapses them independently', async () => {
    const wrapper = mountControls();
    for (const section of ['projection', 'thickness']) {
      expect(
        wrapper
          .get(`[data-testid="oct-${section}-toggle"]`)
          .attributes('aria-expanded')
      ).toBe('true');
    }
    expect(
      wrapper.find('[data-testid="oct-segmentation-segment"] input').exists()
    ).toBe(true);
    expect(
      wrapper
        .find('[data-testid="oct-thickness-threshold-input"] input')
        .exists()
    ).toBe(true);
    expect(wrapper.find('[data-testid="oct-window-width"]').exists()).toBe(
      false
    );
    expect(
      wrapper.find('[data-testid="oct-segmentation-group"]').exists()
    ).toBe(false);
    expect(
      wrapper.get('[data-testid="oct-projection-method"] input').element
    ).toBeDefined();
    expect(
      wrapper
        .get('[data-testid="oct-thin-highlight"]')
        .element.compareDocumentPosition(
          wrapper.get('[data-testid="oct-segmentation-segment"]').element
        ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    const projection = wrapper.get('[data-testid="oct-projection-toggle"]');
    const thickness = wrapper.get('[data-testid="oct-thickness-toggle"]');
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
    const toggle = wrapper.get('[data-testid="oct-projection-toggle"]');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(wrapper.findAll('[data-testid="oct-projection-axis"]')).toHaveLength(
      1
    );
    expect(
      wrapper.get<HTMLInputElement>('[data-testid="oct-projection-axis"] input')
        .element.value
    ).toBe('Z (frames)');
    expect(
      wrapper.get<HTMLInputElement>(
        '[data-testid="oct-projection-method"] input'
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
    const swatch = () => wrapper.get('[data-testid="oct-segment-color"]');
    expect(swatch().attributes('style')).toContain('background-color: #ff0000');
    await wrapper.setProps({
      segments: [
        { value: 'retina', title: 'Retinal layer', color: '#ff0000' },
        { value: 'other-layer', title: 'Other layer', color: '#00ff00' },
      ],
      settings: { ...wrapper.props('settings'), selectedMaskId: 'other-layer' },
    });
    expect(swatch().attributes('style')).toContain('background-color: #00ff00');
    expect(
      wrapper.get('[data-testid="oct-segmentation-segment"]').text()
    ).toContain('Other layer');
    await wrapper
      .get('[data-testid="oct-segmentation-segment"] input')
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
            .querySelector('[data-testid="oct-segment-option-color"]')
            ?.getAttribute('style')
        ).toContain(`background-color: ${color}`);
      }
    });
    expect(
      wrapper
        .get('[data-testid="oct-thin-highlight"]')
        .find('.color-dot')
        .exists()
    ).toBe(false);
    expect(wrapper.get('[data-testid="oct-thin-highlight"]').text()).toContain(
      'Highlight thin regions'
    );
    await wrapper.setProps({ segments: [] });
    expect(wrapper.find('[data-testid="oct-segment-color"]').exists()).toBe(
      false
    );
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

  it('keeps the threshold slider range fixed while preserving larger numeric thresholds', async () => {
    const wrapper = mountControls();
    const slider = wrapper.get(
      '[data-testid="oct-thickness-threshold"] [role="slider"]'
    );
    expect(slider.attributes('aria-label')).toBe(
      'OCT thickness threshold in micrometers'
    );
    expect(slider.attributes('aria-valuemax')).toBe('200');
    await slider.trigger('keydown', { key: 'ArrowRight' });
    expect(lastPatch(wrapper)).toEqual({ thresholdMicrons: 100.1 });
    expect(
      wrapper.get<HTMLInputElement>(
        '[data-testid="oct-thickness-threshold-input"] input'
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
        '[data-testid="oct-thickness-threshold-input"] input'
      )
      .setValue('750.25');
    expect(lastPatch(wrapper)).toEqual({ thresholdMicrons: 750.25 });
    expect(slider.attributes('aria-valuemax')).toBe('200');
    expect(slider.attributes('aria-valuenow')).toBe('200');
    expect(
      wrapper.get<HTMLInputElement>(
        '[data-testid="oct-thickness-threshold-input"] input'
      ).element.value
    ).toBe('750.25');
    await wrapper.setProps({ thresholdMaximum: 50 });
    expect(slider.attributes('aria-valuemax')).toBe('50');
    expect(slider.attributes('aria-valuenow')).toBe('50');
    expect(
      wrapper.get<HTMLInputElement>(
        '[data-testid="oct-thickness-threshold-input"] input'
      ).element.value
    ).toBe('750.25');
  });

  it('keeps calibrated thickness actions disabled when the selected axis has no physical spacing', async () => {
    const wrapper = mountControls();
    const reason = 'Physical A-line spacing is unavailable.';
    await wrapper.setProps({
      highlightReason: reason,
      thicknessReason: reason,
    });
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
    expect(slider.attributes('aria-label')).toBe(
      'OCT thickness threshold in micrometers'
    );
    expect(slider.attributes('tabindex')).toBe('-1');
    await slider.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('patch')).toBeUndefined();
    const action = wrapper
      .findAllComponents(ReasonedAction)
      .find((candidate) =>
        candidate.find('[data-testid="oct-thin-highlight"]').exists()
      );
    expect(action?.props('reason')).toBe(reason);
  });

  it('explains occupied-mask thickness and its user threshold on keyboard focus', async () => {
    const wrapper = mountControls();
    expect(
      wrapper.get('[data-testid="oct-segmentation-segment"]').text()
    ).toContain('Thickness segment');
    const help = wrapper.get<HTMLButtonElement>(
      '[data-testid="oct-thickness-help"]'
    );
    help.element.focus();
    expect(document.activeElement).toBe(help.element);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        'independent of the intensity slab'
      );
      expect(document.body.textContent).toContain(
        'missing coverage and zero thickness cannot be distinguished'
      );
      expect(document.body.textContent).toContain(
        'not a normal reference range'
      );
    });
  });

  it('adjusts inclusive slab bounds with two named keyboard-operated thumbs', async () => {
    const wrapper = mountControls({ depthStart: 100, depthEnd: 221 });
    const range = wrapper.get('[data-testid="oct-slab-range"]');
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

  it('keeps unavailable thickness controls visible and exposes the reason through their wrapper', async () => {
    const wrapper = mountControls();
    const toggle = wrapper.get('[data-testid="oct-thin-highlight"] input');
    const segment = wrapper.get(
      '[data-testid="oct-segmentation-segment"] input'
    );
    await toggle.setValue(false);
    expect(segment.attributes('disabled')).toBeDefined();
    const segmentAction = wrapper
      .findAllComponents(ReasonedAction)
      .find((action) =>
        action.find('[data-testid="oct-segmentation-segment"]').exists()
      );
    expect(segmentAction?.props('reason')).toBe(
      'Enable thin-region highlighting to choose a segment.'
    );
    await wrapper.setProps({
      thicknessReason: 'The selected segment is hidden.',
    });
    expect(toggle.attributes('disabled')).toBeUndefined();
    await toggle.setValue(true);
    expect(segment.attributes('disabled')).toBeUndefined();
    const reason = 'Load an associated segmentation to measure thickness.';
    await wrapper.setProps({
      segments: [],
      segmentationReason: reason,
      highlightReason: reason,
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
