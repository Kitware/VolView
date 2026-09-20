import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import LabelEditor from '@/src/components/LabelEditor.vue';

const Button = defineComponent({
  props: ['disabled'],
  template: '<button :disabled="disabled"><slot /></button>',
});

const Shell = { template: '<div><slot /></div>' };

const mountEditor = () =>
  mount(LabelEditor, {
    props: { color: '#ff0000', valid: true },
    global: {
      stubs: {
        VCard: Shell,
        VCardItem: Shell,
        VCardActions: Shell,
        VBtn: Button,
        VTooltip: Shell,
        VSpacer: true,
        VColorPicker: true,
      },
    },
  });

describe('editor actions while a segment becomes locked', () => {
  it.each(['Delete', 'Done'])(
    'disables and guards %s until unlocking',
    async (action) => {
      const wrapper = mountEditor();
      const button = wrapper
        .findAllComponents(Button)
        .find((candidate) => candidate.text() === action)!;
      await wrapper.setProps({
        disabledReason: 'Unlock this segment to edit or delete it',
      });
      expect(button.attributes('disabled')).toBeDefined();
      expect(button.element.parentElement?.textContent).toContain(
        'Unlock this segment'
      );
      // A stale UI event must obey the same eligibility as the visible button.
      button.vm.$emit('click');
      expect(wrapper.emitted('done')).toBeUndefined();
      expect(wrapper.emitted('delete')).toBeUndefined();

      await wrapper.setProps({ disabledReason: undefined });
      expect(button.attributes('disabled')).toBeUndefined();
      await button.trigger('click');
      expect(
        wrapper.emitted(action === 'Delete' ? 'delete' : 'done')
      ).toHaveLength(1);
      wrapper.unmount();
    }
  );
});
