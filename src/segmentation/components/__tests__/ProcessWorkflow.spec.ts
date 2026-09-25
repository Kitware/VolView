import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createApp, defineComponent, nextTick } from 'vue';
import { flushPromises, mount, VueWrapper } from '@vue/test-utils';

import ProcessWorkflow from '@/src/segmentation/components/ProcessWorkflow.vue';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import {
  addActiveSegment,
  seatImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import {
  usePaintProcessStore,
  type ProcessTarget,
} from '@/src/segmentation/editing/paintProcess';
import { useViewStore } from '@/src/store/views';

// ---------------------------------------------------------------------------
// The Original/Processed pair is a segmented choice, not a switch: the toggle
// is mandatory, so clicking the button already selected keeps the selection
// but still fires the click. Each button therefore states what it shows.
// ---------------------------------------------------------------------------

const BtnStub = defineComponent({
  name: 'VBtn',
  props: ['value', 'prependIcon', 'loading', 'disabled', 'variant'],
  template: `<button
    :data-value="value"
    :disabled="disabled || undefined"
  ><slot /></button>`,
});

const BtnToggleStub = defineComponent({
  name: 'VBtnToggle',
  props: ['modelValue', 'mandatory', 'variant', 'divided', 'density'],
  template: `<div class="btn-toggle" :data-selected="modelValue"><slot /></div>`,
});

const globalOptions = {
  stubs: {
    VRow: { template: '<div><slot /></div>' },
    VBtn: BtnStub,
    VBtnToggle: BtnToggleStub,
    // The icon name is slot text, which would land in the button's label.
    VIcon: { template: '<i />' },
  },
};

const processed = async (target: ProcessTarget) => ({
  scalars: new Uint8Array([1, 1]),
  extent: target.maskExtent,
});

const button = (wrapper: VueWrapper, label: string) => {
  const found = wrapper
    .findAll('button')
    .find((candidate) => candidate.text().trim() === label);
  if (!found) throw new Error(`No ${label} button`);
  return found;
};

const selected = (wrapper: VueWrapper) =>
  wrapper.get('.btn-toggle').attributes('data-selected');

describe('the process preview toggle', () => {
  beforeEach(async () => {
    const pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
    await seatImage('image-1', { dimensions: [2, 1, 1] });
    useViewStore().setDataForAllViews('image-1');
    await nextTick();
  });

  const previewing = async () => {
    const { labelMap } = addActiveSegment(new Uint8Array([1, 0]));
    const wrapper = mount(ProcessWorkflow, {
      props: { algorithm: processed },
      global: globalOptions,
    });
    await button(wrapper, 'Preview').trigger('click');
    await flushPromises();
    const values = () =>
      Array.from(labelMap.getPointData().getScalars().getData());
    expect(usePaintProcessStore().processStep).toBe('previewing');
    return { wrapper, values, processStore: usePaintProcessStore() };
  };

  it('leaves the preview alone when the showing button is clicked again', async () => {
    const { wrapper, values, processStore } = await previewing();
    expect(selected(wrapper)).toBe('1');
    expect(values()).toEqual([1, 1]);

    await button(wrapper, 'Processed').trigger('click');

    expect(processStore.showingOriginal).toBe(false);
    expect(selected(wrapper)).toBe('1');
    expect(values()).toEqual([1, 1]);
  });

  it('shows the original once, however often its button is clicked', async () => {
    const { wrapper, values, processStore } = await previewing();

    await button(wrapper, 'Original').trigger('click');

    expect(processStore.showingOriginal).toBe(true);
    expect(selected(wrapper)).toBe('0');
    expect(values()).toEqual([1, 0]);

    await button(wrapper, 'Original').trigger('click');

    expect(processStore.showingOriginal).toBe(true);
    expect(selected(wrapper)).toBe('0');
    expect(values()).toEqual([1, 0]);
  });

  it('still moves between the two', async () => {
    const { wrapper, values, processStore } = await previewing();

    await button(wrapper, 'Original').trigger('click');
    await button(wrapper, 'Processed').trigger('click');

    expect(processStore.showingOriginal).toBe(false);
    expect(selected(wrapper)).toBe('1');
    expect(values()).toEqual([1, 1]);
  });
});
