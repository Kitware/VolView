import { defineComponent } from 'vue';
import { enableAutoUnmount, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import SegmentEditor from '@/src/segmentation/components/SegmentEditor.vue';

enableAutoUnmount(afterEach);

const Shell = { template: '<div><slot /></div>' };

const ButtonStub = defineComponent({
  name: 'VBtn',
  props: ['disabled'],
  template: '<button :disabled="disabled"><slot /></button>',
});

const TextFieldStub = defineComponent({
  name: 'VTextField',
  props: ['modelValue', 'rules'],
  emits: ['update:modelValue'],
  template:
    '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

const SliderStub = defineComponent({
  name: 'VSlider',
  props: ['name', 'modelValue', 'min', 'max', 'step'],
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
      locked: false,
    },
    global: {
      stubs: {
        VCard: Shell,
        VCardItem: Shell,
        VCardActions: Shell,
        VBtn: ButtonStub,
        VTooltip: Shell,
        VSpacer: true,
        VColorPicker: true,
        VTextField: TextFieldStub,
        VSlider: SliderStub,
      },
    },
  });

const actionButton = (wrapper: VueWrapper, label: string) =>
  wrapper
    .findAllComponents(ButtonStub)
    .find((candidate) => candidate.text() === label)!;

describe('segment editor name validation', () => {
  it('allows an unchanged duplicate name', () => {
    const wrapper = mountEditor();

    expect(
      actionButton(wrapper, 'Done').attributes('disabled')
    ).toBeUndefined();
    const [rule] = wrapper.findComponent(TextFieldStub).props('rules');
    expect(rule('Tumor')).toBe(true);
  });

  it("rejects changing to another segment's name", async () => {
    const wrapper = mountEditor();

    await wrapper.setProps({ name: ' Node ' });

    const done = actionButton(wrapper, 'Done');
    expect(done.attributes('disabled')).toBeDefined();
    expect(done.element.parentElement?.textContent).toContain(
      'Choose a unique name'
    );
    const [rule] = wrapper.findComponent(TextFieldStub).props('rules');
    expect(rule(' Node ')).toBe('Name is not unique');
  });
});

describe('editor delete', () => {
  it('says it removes the segment from every image', () => {
    const remove = actionButton(mountEditor(), 'Delete');

    expect(remove.attributes('aria-label')).toBe(
      'Delete this segment from every image'
    );
    expect(remove.element.parentElement?.textContent).toContain(
      'Delete from every image'
    );
  });
});

describe('editor actions while a segment becomes locked', () => {
  it.each(['Delete', 'Done'])(
    'disables and guards %s until unlocking',
    async (action) => {
      const wrapper = mountEditor();
      const button = actionButton(wrapper, action);
      await wrapper.setProps({ locked: true });
      expect(button.attributes('disabled')).toBeDefined();
      expect(button.element.parentElement?.textContent).toContain(
        'Unlock this segment'
      );
      // A stale UI event must obey the same eligibility as the visible button.
      button.vm.$emit('click');
      expect(wrapper.emitted('done')).toBeUndefined();
      expect(wrapper.emitted('delete')).toBeUndefined();

      await wrapper.setProps({ locked: false });
      expect(button.attributes('disabled')).toBeUndefined();
      await button.trigger('click');
      const [emitted, other] =
        action === 'Delete' ? ['delete', 'done'] : ['done', 'delete'];
      expect(wrapper.emitted(emitted)).toHaveLength(1);
      expect(wrapper.emitted(other)).toBeUndefined();
    }
  );
});

describe('segment editor stroke width', () => {
  it('offers integer stroke widths from 1 through 5', () => {
    const wrapper = mountEditor();
    const strokeWidth = wrapper
      .findAllComponents(SliderStub)
      .find((slider) => slider.props('name') === 'Stroke Width');

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
      .find((slider) => slider.props('name') === 'Stroke Width')!;

    strokeWidth.vm.$emit('update:modelValue', 3.6);

    expect(wrapper.emitted('update:strokeWidth')).toEqual([[4]]);
  });
});

describe('segment editor field events', () => {
  it.each([
    ['Fill Opacity', 'update:fillOpacity'],
    ['Outline Opacity', 'update:outlineOpacity'],
  ])('emits %s changes', (name, event) => {
    const wrapper = mountEditor();
    const slider = wrapper
      .findAllComponents(SliderStub)
      .find((candidate) => candidate.props('name') === name)!;
    slider.vm.$emit('update:modelValue', 0.35);
    expect(wrapper.emitted(event)).toEqual([[0.35]]);
  });

  it('emits a name change from the name field', async () => {
    const wrapper = mountEditor();
    await wrapper.get('input').setValue('Lesion');
    expect(wrapper.emitted('update:name')).toEqual([['Lesion']]);
  });

  it('finishes from Enter in the name field', async () => {
    const wrapper = mountEditor();
    await wrapper.get('input').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('done')).toEqual([[]]);
  });
});
