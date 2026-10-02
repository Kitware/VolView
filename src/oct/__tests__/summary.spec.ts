import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import EnFaceSummary from '@/src/oct/EnFaceSummary.vue';
import EnFaceStatus from '@/src/oct/EnFaceStatus.vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { defaultOCTViewConfig } from '@/src/oct/store';

enableAutoUnmount(afterEach);
const global = { plugins: [createVuetify()] };

function mountSummary() {
  return mount(EnFaceSummary, {
    props: {
      settings: {
        ...defaultOCTViewConfig(),
        highlightThin: true,
        thresholdMicrons: 30,
      },
      projection: { width: 3, height: 1, values: new Float32Array(3) },
      depthStart: 80,
      depthEnd: 320,
      segmentName: 'INL',
      highlightedPixels: 2,
      highlightReason: null,
      stateMessage: null,
    },
    global,
  });
}

describe('En face measurement context', () => {
  it('identifies the layer and threshold, and explains blocked highlighting without a live region', async () => {
    const wrapper = mountSummary();
    expect(wrapper.text()).toContain('Mean • slab 80–320');
    expect(wrapper.text()).toContain('INL: 2 thin pixels (< 30 µm)');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    await wrapper.setProps({
      highlightReason: 'The selected segment is hidden.',
      highlightedPixels: 0,
      settings: { ...wrapper.props('settings'), thresholdMicrons: 20.8 },
    });
    expect(wrapper.text()).toContain('INL: Highlight unavailable (< 20.8 µm)');
    expect(wrapper.text()).not.toContain('0 thin pixels');
    const action = wrapper.getComponent(ReasonedAction);
    expect(action.props('reason')).toBe('The selected segment is hidden.');
    expect(action.attributes('tabindex')).toBe('0');
    await wrapper.setProps({
      settings: { ...wrapper.props('settings'), highlightThin: false },
    });
    expect(wrapper.text()).not.toContain('Highlight unavailable');
  });

  it('distinguishes missing intensity and unmeasurable thickness from absent labels', async () => {
    const wrapper = mountSummary();
    await wrapper.setProps({
      projection: {
        width: 3,
        height: 1,
        values: new Float32Array([0.25, 0, 0.5]),
        validPixels: new Uint8Array([1, 0, 1]),
        thicknessMicrons: new Float64Array([20, NaN, 0]),
      },
    });
    const coverage = wrapper.get('[data-testid="oct-coverage-summary"]');
    expect(coverage.text()).toContain('A-lines without intensity: 1');
    expect(coverage.text()).toContain('A-lines with thickness unavailable: 1');
    expect(coverage.find('span[tabindex="0"]').exists()).toBe(true);
    await wrapper.setProps({
      projection: {
        width: 3,
        height: 1,
        values: new Float32Array(3),
        validPixels: new Uint8Array([1, 1, 1]),
        thicknessMicrons: new Float64Array([20, 0, 0]),
      },
    });
    expect(wrapper.find('[data-testid="oct-coverage-summary"]').exists()).toBe(
      false
    );
  });
});

describe('En face projection announcements', () => {
  it('keeps one live region through waiting, failure, retry and completion', async () => {
    const wrapper = mount(EnFaceStatus, {
      props: {
        message: 'Generating en face projection…',
        ready: false,
        retryable: false,
      },
      global,
    });
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
    expect(wrapper.attributes('aria-live')).toBe('polite');
    await wrapper.setProps({ message: 'Worker failed.', retryable: true });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
    await wrapper.setProps({
      message: 'Generating en face projection…',
      retryable: false,
    });
    expect(wrapper.find('button').exists()).toBe(false);
    await wrapper.setProps({ message: null, ready: true });
    expect(wrapper.text()).toBe('En face projection ready.');
    expect(wrapper.classes()).toContain('d-sr-only');
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
  });
});
