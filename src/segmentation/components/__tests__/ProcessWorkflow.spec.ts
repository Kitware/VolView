import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import {
  enableAutoUnmount,
  flushPromises,
  mount,
  VueWrapper,
} from '@vue/test-utils';

import ProcessWorkflow from '@/src/segmentation/components/ProcessWorkflow.vue';
import {
  addActiveSegment,
  activateAppPinia,
  viewImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import type { ProcessTarget } from '@/src/segmentation/editing/paintProcess';
import { useViewStore } from '@/src/store/views';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { markCine } from '@/src/core/cine/__tests__/cineFixtures';

enableAutoUnmount(afterEach);

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
    VTooltip: {
      props: ['disabled'],
      template: `<span v-if="!disabled" role="tooltip"><slot /></span>`,
    },
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

beforeEach(async () => {
  activateAppPinia();
  await viewImage('image-1', { dimensions: [2, 1, 1] });
  useToolStore().setCurrentTool(Tools.Paint);
});

describe('the process preview toggle', () => {
  const previewing = async () => {
    addActiveSegment(new Uint8Array([1, 0]));
    const wrapper = mount(ProcessWorkflow, {
      props: { algorithm: processed },
      global: globalOptions,
    });
    await button(wrapper, 'Preview').trigger('click');
    await flushPromises();
    expect(wrapper.find('.btn-toggle').exists()).toBe(true);
    return wrapper;
  };

  it('leaves the preview alone when the showing button is clicked again', async () => {
    const wrapper = await previewing();
    expect(selected(wrapper)).toBe('1');

    await button(wrapper, 'Processed').trigger('click');

    expect(selected(wrapper)).toBe('1');
  });

  it('shows the original once, however often its button is clicked', async () => {
    const wrapper = await previewing();

    await button(wrapper, 'Original').trigger('click');

    expect(selected(wrapper)).toBe('0');

    await button(wrapper, 'Original').trigger('click');

    expect(selected(wrapper)).toBe('0');
  });

  it('still moves between the two', async () => {
    const wrapper = await previewing();

    await button(wrapper, 'Original').trigger('click');
    await button(wrapper, 'Processed').trigger('click');

    expect(selected(wrapper)).toBe('1');
  });
});

describe('the process Preview button', () => {
  const mountWorkflow = () =>
    mount(ProcessWorkflow, {
      props: { algorithm: processed },
      global: globalOptions,
    });

  it('stays visible but disabled, saying why, when nothing can run', () => {
    const wrapper = mountWorkflow();

    expect(button(wrapper, 'Preview').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[role="tooltip"]').text()).toBe(
      'No segment content to process'
    );
  });

  it('asks for the Paint tool while another tool is active', async () => {
    addActiveSegment(new Uint8Array([1, 0]));
    useToolStore().setCurrentTool(Tools.WindowLevel);
    const wrapper = mountWorkflow();
    await nextTick();

    expect(button(wrapper, 'Preview').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[role="tooltip"]').text()).toBe(
      'Select the Paint tool to run a process'
    );
  });

  it.each([
    ['no image is viewed', undefined, 'Load an image to paint'],
    ['a clip is viewed', 'cine-1', 'A clip cannot be painted'],
  ])(
    'says why Paint is unavailable when %s',
    async (_case, imageId, reason) => {
      addActiveSegment(new Uint8Array([1, 0]));
      markCine('cine-1');
      useViewStore().setDataForAllViews(imageId);
      const wrapper = mountWorkflow();
      await nextTick();

      expect(button(wrapper, 'Preview').attributes('disabled')).toBeDefined();
      expect(wrapper.get('[role="tooltip"]').text()).toBe(reason);
    }
  );

  it('is enabled with no reason once a segment has content', async () => {
    addActiveSegment(new Uint8Array([1, 0]));
    const wrapper = mountWorkflow();
    await nextTick();

    expect(button(wrapper, 'Preview').attributes('disabled')).toBeUndefined();
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
  });
});
