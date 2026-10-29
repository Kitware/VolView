import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';

import { createVuetify } from 'vuetify';
import EnFaceControls from '@/src/enface/EnFaceControls.vue';
import {
  defaultEnFaceViewConfig,
  type EnFaceViewConfig,
} from '@/src/enface/store';

beforeEach(() => {
  vi.stubGlobal('visualViewport', null);
});
afterEach(() => vi.unstubAllGlobals());
enableAutoUnmount(afterEach);

function mountControls(overrides = {}) {
  const settings = reactive({
    ...defaultEnFaceViewConfig(),
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
    },
    global: { plugins: [createVuetify()] },
  });
}

function lastPatch(wrapper: ReturnType<typeof mountControls>) {
  return wrapper.emitted('patch')?.at(-1)?.[0];
}

describe('En face rendering controls', () => {
  it('starts projection controls expanded and can collapse them', async () => {
    const wrapper = mountControls();
    const projection = wrapper.get('[data-testid="enface-projection-toggle"]');
    expect(projection.attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('[data-testid="enface-window-width"]').exists()).toBe(
      false
    );
    await projection.trigger('click');
    expect(projection.attributes('aria-expanded')).toBe('false');
    await projection.trigger('click');
    expect(projection.attributes('aria-expanded')).toBe('true');
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
});
