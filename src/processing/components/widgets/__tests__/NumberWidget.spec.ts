// ---------------------------------------------------------------------------
// NumberWidget parsing: reject instead of coerce. parseInt-style truncation
// ("1.9" -> 1) silently submitted a value the user never entered; the widget
// must emit null for non-integral / invalid-step / non-numeric input on an
// int param and surface the problem inline.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { defineComponent } from 'vue';
import { shallowMount } from '@vue/test-utils';

import NumberWidget from '@/src/processing/components/widgets/NumberWidget.vue';
import type { VolViewTaskParameter } from '@/backend-contract';

const TextFieldStub = defineComponent({
  name: 'VTextField',
  props: ['modelValue', 'errorMessages'],
  emits: ['update:modelValue'],
  template: '<input />',
});

const mountWidget = (
  param: Partial<VolViewTaskParameter>,
  modelValue: number | null = null
) =>
  shallowMount(NumberWidget, {
    props: {
      param: { id: 'p', ...param } as VolViewTaskParameter,
      modelValue,
    },
    global: { stubs: { VTextField: TextFieldStub } },
  });

const type = async (wrapper: ReturnType<typeof mountWidget>, text: string) => {
  await wrapper
    .findComponent(TextFieldStub)
    .vm.$emit('update:modelValue', text);
};

const lastEmitted = (wrapper: ReturnType<typeof mountWidget>) =>
  wrapper.emitted('update:modelValue')!.at(-1)![0];

const fieldError = (wrapper: ReturnType<typeof mountWidget>) =>
  wrapper.findComponent(TextFieldStub).props('errorMessages');

describe('NumberWidget input parsing', () => {
  it('parses a float param with full precision', async () => {
    const w = mountWidget({ kind: 'float' });
    await type(w, '1.9');
    expect(lastEmitted(w)).toBe(1.9);
    expect(fieldError(w)).toEqual([]);
  });

  it('rejects fractional input on an int param instead of truncating', async () => {
    const w = mountWidget({ kind: 'int' });
    await type(w, '1.9');
    expect(lastEmitted(w)).toBeNull();
    expect(fieldError(w)).toBe('Enter a whole number');
  });

  it('accepts integral input on an int param', async () => {
    const w = mountWidget({ kind: 'int' });
    await type(w, '2');
    expect(lastEmitted(w)).toBe(2);
    expect(fieldError(w)).toEqual([]);
  });

  it('rejects off-step input on an int param with min+step', async () => {
    const w = mountWidget({ kind: 'int', min: 1, step: 2 });
    await type(w, '4'); // valid values are 1, 3, 5, ...
    expect(lastEmitted(w)).toBeNull();
    expect(fieldError(w)).toBe('Enter a value in steps of 2 from 1');
    await type(w, '3');
    expect(lastEmitted(w)).toBe(3);
    expect(fieldError(w)).toEqual([]);
  });

  it('rejects non-numeric input', async () => {
    const w = mountWidget({ kind: 'int' });
    await type(w, 'abc');
    expect(lastEmitted(w)).toBeNull();
    expect(fieldError(w)).toBe('Enter a number');
  });

  it('clearing the field emits null with no error', async () => {
    const w = mountWidget({ kind: 'int' }, 3);
    await type(w, '');
    expect(lastEmitted(w)).toBeNull();
    expect(fieldError(w)).toEqual([]);
  });

  it('keeps the rejected text visible instead of clobbering it', async () => {
    const w = mountWidget({ kind: 'int' }, 1);
    await type(w, '1.9');
    // The parent reflects the emitted null back; the raw text must survive.
    await w.setProps({ modelValue: null });
    expect(w.findComponent(TextFieldStub).props('modelValue')).toBe('1.9');
  });
});
