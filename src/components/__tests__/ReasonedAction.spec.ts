import { h } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ReasonedAction from '@/src/components/ReasonedAction.vue';

const mountAction = (props: { reason?: string; tooltip?: string }) =>
  mount(ReasonedAction, {
    props,
    slots: {
      default: ({ disabled }: { disabled: boolean }) =>
        h('button', { disabled }, 'Save'),
    },
    global: {
      stubs: { VTooltip: { template: '<span role="tooltip"><slot /></span>' } },
    },
  });

describe('ReasonedAction', () => {
  it('disables the control and says why while a reason stands', () => {
    const wrapper = mountAction({ reason: 'Nothing to save', tooltip: 'Save' });

    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.attributes('tabindex')).toBe('0');
    expect(wrapper.get('[role="tooltip"]').text()).toBe('Nothing to save');
  });

  it('leaves the control enabled under its label without a reason', () => {
    const wrapper = mountAction({ reason: '', tooltip: 'Save' });

    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    expect(wrapper.attributes('tabindex')).toBeUndefined();
    expect(wrapper.get('[role="tooltip"]').text()).toBe('Save');
  });

  it('shows no tooltip when there is neither a reason nor a label', () => {
    expect(mountAction({}).find('[role="tooltip"]').exists()).toBe(false);
  });
});
