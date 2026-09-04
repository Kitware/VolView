import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SliceSlider from '@/src/components/SliceSlider.vue';

const mountSlider = () =>
  mount(SliceSlider, {
    props: { min: 0, max: 10, step: 1 },
  });

describe('SliceSlider', () => {
  it('ignores a late pointer event after its element is gone', () => {
    const wrapper = mountSlider();
    const vm = wrapper.vm as unknown as {
      onDragMove: (event: PointerEvent) => void;
    };
    wrapper.unmount();

    expect(() => vm.onDragMove({ pointerId: 7 } as PointerEvent)).not.toThrow();
  });

  it('keeps dragging when an unrelated pointer ends', async () => {
    const wrapper = mountSlider();
    await wrapper.trigger('pointerdown', { pointerId: 7, pageY: 10 });

    const vm = wrapper.vm as unknown as {
      dragging: boolean;
      pointerId: number | null;
      onDragEnd: (event: PointerEvent) => void;
    };
    vm.onDragEnd({ pointerId: 8 } as PointerEvent);

    expect(vm.dragging).toBe(true);
    expect(vm.pointerId).toBe(7);
  });
});
