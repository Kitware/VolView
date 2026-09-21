import { defineComponent, h, nextTick } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ReasonedAction from '@/src/components/ReasonedAction.vue';

enableAutoUnmount(afterEach);

const TooltipStub = defineComponent({
  name: 'VTooltip',
  props: ['activator'],
  template: '<span role="tooltip"><slot /></span>',
});

const mountAction = (props: { reason?: string; tooltip?: string }) =>
  mount(ReasonedAction, {
    props,
    slots: {
      default: ({ disabled }: { disabled: boolean }) =>
        h('button', { disabled }, 'Save'),
    },
    global: {
      stubs: { VTooltip: TooltipStub },
    },
  });

const activatorOf = (wrapper: ReturnType<typeof mountAction>) =>
  wrapper.getComponent(TooltipStub).props('activator');

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

  it('hangs an enabled control’s label on the control, so focusing it shows the label', async () => {
    const wrapper = mountAction({ reason: '', tooltip: 'Save' });
    await nextTick();

    expect(activatorOf(wrapper)).toBe(wrapper.get('button').element);
  });

  it('hangs the reason on the focusable wrapper once the control is disabled', async () => {
    const wrapper = mountAction({ reason: '', tooltip: 'Save' });
    await nextTick();

    await wrapper.setProps({ reason: 'Nothing to save' });

    expect(activatorOf(wrapper)).toBe('parent');
  });
});
