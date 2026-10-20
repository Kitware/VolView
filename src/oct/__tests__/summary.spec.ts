import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import EnFaceStatus from '@/src/oct/EnFaceStatus.vue';

enableAutoUnmount(afterEach);
const global = { plugins: [createVuetify()] };

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
