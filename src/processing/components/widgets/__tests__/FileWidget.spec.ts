import { describe, expect, it } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { defineComponent } from 'vue';

import FileWidget from '@/src/processing/components/widgets/FileWidget.vue';
import type { VolViewTaskParameter } from '@/backend-contract';

const annotationsParam = (required: boolean): VolViewTaskParameter => ({
  kind: 'sourceRef',
  id: 'inputAnnotations',
  accepts: ['annotations'],
  required,
});

const IconStub = defineComponent({
  name: 'VIcon',
  template: '<i><slot /></i>',
});

const global = { stubs: { VIcon: IconStub } };

const mountWidget = (required: boolean, binding = 'no-annotations' as const) =>
  shallowMount(FileWidget, {
    props: {
      param: annotationsParam(required),
      modelValue: null,
      binding,
    },
    global,
  });

describe('FileWidget optional source refs', () => {
  it('renders an automatic input as an icon-bearing key and a value', () => {
    const wrapper = shallowMount(FileWidget, {
      props: {
        param: {
          kind: 'sourceRef',
          id: 'inputVolume',
          accepts: ['image'],
          required: true,
        },
        modelValue: null,
        binding: 'bound',
        boundName: 'CT Images',
      },
      global,
    });

    expect(wrapper.get('.key-text').text()).toBe('Active dataset');
    expect(wrapper.get('.input-key').text()).toContain('mdi-image-outline');
    expect(wrapper.get('.input-value').text()).not.toContain(
      'mdi-image-outline'
    );
    expect(wrapper.get('.input-value').text()).toContain('CT Images');
  });

  it('renders an absent optional annotations input as an intentional omission', () => {
    const wrapper = mountWidget(false);

    expect(wrapper.get('.key-text').text()).toBe('Annotations (optional)');
    expect(wrapper.get('.input-value').text()).toBe('Not provided');
    expect(wrapper.text()).not.toMatch(/place a ruler/i);
    expect(wrapper.get('.input-value').classes()).not.toContain('text-error');
  });

  it('keeps the placement instruction for a required annotations input', () => {
    const wrapper = mountWidget(true);

    expect(wrapper.get('.key-text').text()).toBe('Annotations');
    expect(wrapper.get('.input-value').classes()).toContain('text-error');
    expect(wrapper.get('.input-value').text()).toMatch(/place a ruler/i);
  });
});

const labelmapParam = (
  overrides: Partial<Extract<VolViewTaskParameter, { kind: 'sourceRef' }>> = {}
): VolViewTaskParameter => ({
  kind: 'sourceRef',
  id: 'inputSeg',
  accepts: ['labelmap'],
  required: true,
  ...overrides,
});

const mountLabelmap = (
  param: VolViewTaskParameter,
  props: Record<string, unknown> = {}
) =>
  shallowMount(FileWidget, {
    props: { param, modelValue: null, ...props },
    global,
  });

describe('FileWidget plural segment groups', () => {
  it('names the whole group set for a multiple param', () => {
    const wrapper = mountLabelmap(labelmapParam({ multiple: true }));

    expect(wrapper.get('.key-text').text()).toBe(
      'Segment groups on active dataset'
    );
  });

  it('names only the active group for a singular param', () => {
    const wrapper = mountLabelmap(labelmapParam());

    expect(wrapper.get('.key-text').text()).toBe('Active segment group');
  });

  it('keeps the plural caption once the binder resolves a union param', () => {
    const wrapper = mountLabelmap(
      labelmapParam({ accepts: ['image', 'labelmap'], multiple: true }),
      { boundType: 'labelmap' }
    );

    expect(wrapper.get('.key-text').text()).toBe(
      'Segment groups on active dataset'
    );
  });

  it('leaves a multiple image param on the dataset caption', () => {
    const wrapper = mountLabelmap(
      labelmapParam({ accepts: ['image'], multiple: true })
    );

    expect(wrapper.get('.key-text').text()).toBe('Active dataset');
  });

  it('drops the select remedy from the unbound message', () => {
    const wrapper = mountLabelmap(labelmapParam({ multiple: true }), {
      binding: 'no-segment-group',
    });

    expect(wrapper.get('.input-value').text()).toBe(
      'Paint a segment group on the active dataset first.'
    );
  });

  it('offers the select remedy for a singular param', () => {
    const wrapper = mountLabelmap(labelmapParam(), {
      binding: 'no-segment-group',
    });

    expect(wrapper.get('.input-value').text()).toBe(
      'Paint or select a segment group first.'
    );
  });
});
