import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import EnFaceStatus from '@/src/enface/EnFaceStatus.vue';

enableAutoUnmount(afterEach);
const global = { plugins: [createVuetify()] };

describe('En face projection announcements', () => {
  it('keeps one live region through unavailable state, renderer failure and completion', async () => {
    const wrapper = mount(EnFaceStatus, {
      props: {
        message: 'Choose a slab containing image data.',
        ready: false,
      },
      global,
    });
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
    expect(wrapper.get('[role="status"]').attributes('aria-live')).toBe(
      'polite'
    );
    await wrapper.setProps({ message: 'This GPU cannot render the volume.' });
    expect(wrapper.text()).toContain('This GPU cannot render the volume.');
    await wrapper.setProps({
      message: null,
    });
    expect(wrapper.find('button').exists()).toBe(false);
    await wrapper.setProps({ message: null, ready: true });
    expect(wrapper.text()).toBe('En face projection ready.');
    expect(wrapper.get('[role="status"]').classes()).toContain('d-sr-only');
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
    await wrapper.setProps({
      measurementMessage: 'Updating thickness; showing the previous result.',
    });
    expect(wrapper.findAll('[role="status"]')).toHaveLength(2);
    const measurement = wrapper.get(
      '[data-testid="enface-measurement-status"]'
    );
    expect(measurement.attributes('aria-live')).toBe('polite');
    expect(measurement.text()).toBe(
      'Updating thickness; showing the previous result.'
    );
    expect(measurement.classes()).not.toContain('d-sr-only');
    await wrapper.setProps({ message: 'This GPU cannot render the volume.' });
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
    expect(
      wrapper.find('[data-testid="enface-measurement-status"]').exists()
    ).toBe(false);
  });
});
