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
