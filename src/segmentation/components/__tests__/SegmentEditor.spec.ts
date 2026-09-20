import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SegmentEditor from '@/src/segmentation/components/SegmentEditor.vue';

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

const SliderStub = defineComponent({
  name: 'VSlider',
  props: ['label', 'modelValue', 'min', 'max', 'step'],
  emits: ['update:modelValue'],
  template: '<div class="slider" />',
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
        VSlider: SliderStub,
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

describe('segment type editor stroke width', () => {
  it('offers integer stroke widths from 1 through 5', () => {
    const wrapper = mountEditor();
    const strokeWidth = wrapper
      .findAllComponents(SliderStub)
      .find((slider) => slider.props('label') === 'Stroke Width');

    expect(strokeWidth?.props()).toMatchObject({
      modelValue: 1,
      min: 1,
      max: 5,
      step: 1,
    });
  });

  it('emits an integer stroke width', () => {
    const wrapper = mountEditor();
    const strokeWidth = wrapper
      .findAllComponents(SliderStub)
      .find((slider) => slider.props('label') === 'Stroke Width')!;

    strokeWidth.vm.$emit('update:modelValue', 3.6);

    expect(wrapper.emitted('update:strokeWidth')).toEqual([[4]]);
  });
});
