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
    expect(wrapper.attributes('aria-live')).toBe('polite');
    await wrapper.setProps({ message: 'This GPU cannot render the volume.' });
    expect(wrapper.text()).toContain('This GPU cannot render the volume.');
    await wrapper.setProps({
      message: null,
    });
    expect(wrapper.find('button').exists()).toBe(false);
    await wrapper.setProps({ message: null, ready: true });
    expect(wrapper.text()).toBe('En face projection ready.');
    expect(wrapper.classes()).toContain('d-sr-only');
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
  });
});
