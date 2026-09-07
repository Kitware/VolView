import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SegmentEditor from '@/src/components/SegmentEditor.vue';

const LabelEditorStub = defineComponent({
  name: 'LabelEditor',
  props: ['color', 'valid'],
  setup: () => ({ done: () => {} }),
  template: '<div><slot name="fields" :done="done" /></div>',
});

const TextFieldStub = defineComponent({
  name: 'VTextField',
  props: ['modelValue', 'rules'],
  template: '<input />',
});

const mountEditor = () =>
  mount(SegmentEditor, {
    props: {
      name: 'Tumor',
      original: 'Tumor',
      color: '#ff0000',
      invalidNames: new Set(['Tumor', 'Node']),
      fillOpacity: 1,
      outlineOpacity: 1,
      strokeWidth: 1,
    },
    global: {
      stubs: {
        LabelEditor: LabelEditorStub,
        VTextField: TextFieldStub,
        VSlider: true,
      },
    },
  });

describe('segment type editor name validation', () => {
  it('allows an unchanged duplicate name', () => {
    const wrapper = mountEditor();

    expect(wrapper.findComponent(LabelEditorStub).props('valid')).toBe(true);
    const [rule] = wrapper.findComponent(TextFieldStub).props('rules');
    expect(rule('Tumor')).toBe(true);
  });

  it('rejects changing to another type’s name', async () => {
    const wrapper = mountEditor();

    await wrapper.setProps({ name: ' Node ' });

    expect(wrapper.findComponent(LabelEditorStub).props('valid')).toBe(false);
    const [rule] = wrapper.findComponent(TextFieldStub).props('rules');
    expect(rule(' Node ')).toBe('Name is not unique');
  });
});
