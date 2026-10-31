import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useVtkComputed } from '@/src/core/vtk/useVtkComputed';

describe('useVtkComputed', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes displayed values when the VTK object or reactive getter inputs change', async () => {
    const image = shallowRef<vtkImageData | null>(null);
    const multiplier = ref(1);
    const wrapper = mount(
      defineComponent({
        setup() {
          const dimensions = useVtkComputed(image, () =>
            image.value
              ?.getDimensions()
              .map((value) => value * multiplier.value)
          );
          return () => h('output', dimensions.value?.join(',') ?? 'No image');
        },
      })
    );
    expect(wrapper.text()).toBe('No image');

    const first = vtkImageData.newInstance();
    first.setDimensions([2, 3, 4]);
    image.value = first;
    await nextTick();
    expect(wrapper.text()).toBe('2,3,4');

    multiplier.value = 2;
    await nextTick();
    expect(wrapper.text()).toBe('4,6,8');

    const second = vtkImageData.newInstance();
    second.setDimensions([5, 6, 7]);
    image.value = second;
    await nextTick();
    expect(wrapper.text()).toBe('10,12,14');

    image.value = null;
    await nextTick();
    expect(wrapper.text()).toBe('No image');
    wrapper.unmount();
    first.delete();
    second.delete();
  });

  it('refreshes the displayed range after VTK modification and cancels queued work on unmount', async () => {
    vi.useFakeTimers();
    const image = vtkImageData.newInstance();
    const wrapper = mount(
      defineComponent({
        setup() {
          const dimensions = useVtkComputed(image, () => image.getDimensions());
          return () => h('output', dimensions.value.join(','));
        },
      })
    );
    image.setDimensions([2, 3, 4]);
    await vi.runAllTimersAsync();
    expect(wrapper.text()).toBe('2,3,4');

    image.setDimensions([5, 6, 7]);
    wrapper.unmount();
    image.delete();
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });
});
