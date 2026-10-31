import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, onScopeDispose, ref } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { useColoringEffect } from '@/src/composables/useColoringEffect';
import { useVolumeColoringConfig } from '@/src/composables/useVolumeColoringConfig';
import { useVolumeColoringInitializer } from '@/src/composables/useVolumeColoringInitializer';
import { useVtkComputed } from '@/src/core/vtk/useVtkComputed';
import { useImageCacheStore } from '@/src/store/image-cache';
import useVolumeColoringStore from '@/src/store/view-configs/volume-coloring';

const viewID = 'volume';
let wrapper: VueWrapper | undefined;

function addImage(values: number[]) {
  const image = vtkImageData.newInstance();
  const scalars = vtkDataArray.newInstance({
    values: Float32Array.from(values),
    name: 'Scalars',
  });
  image.setDimensions(values.length, 1, 1);
  image.getPointData().setScalars(scalars);
  return {
    image,
    imageID: useImageCacheStore().addVTKImageData(image, 'volume'),
  };
}

async function settleColoring() {
  await nextTick();
  await vi.runAllTimersAsync();
  await nextTick();
}

describe('displayed volume coloring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    Object.values(useImageCacheStore().imageById).forEach((image) =>
      image.dispose()
    );
    vi.useRealTimers();
  });

  it('replaces the previous appearance with a zero-range provisional preset and follows decoded intensities', async () => {
    const first = addImage([-10, -5, 0]);
    const streaming = addImage([0, 0, 0]);
    useImageCacheStore().imageById[streaming.imageID].loaded.value = false;
    const store = useVolumeColoringStore();
    store.setDefaults(streaming.imageID, {
      transferFunction: { preset: 'Grayscale' },
    });
    store.setColorPreset(viewID, first.imageID, 'Grayscale');
    const imageID = ref(first.imageID);
    const sampleValue = ref(0);

    wrapper = mount(
      defineComponent({
        setup() {
          useVolumeColoringInitializer(viewID, imageID);
          const config = useVolumeColoringConfig(viewID, imageID);
          const colors = vtkColorTransferFunction.newInstance();
          const opacity = vtkPiecewiseFunction.newInstance();
          onScopeDispose(() => {
            colors.delete();
            opacity.delete();
          });
          useColoringEffect(config, colors, opacity);
          const rgb = useVtkComputed(colors, () => {
            const color: number[] = [];
            colors.getColor(sampleValue.value, color);
            return color;
          });
          const alpha = useVtkComputed(opacity, () =>
            opacity.getValue(sampleValue.value)
          );
          return () =>
            h('div', [
              h(
                'p',
                { 'data-testid': 'preset' },
                config.value?.transferFunction.preset
              ),
              h('div', {
                'data-testid': 'sample',
                style: {
                  backgroundColor: `rgb(${rgb.value.map((value) => Math.round(value * 255)).join(', ')})`,
                  opacity: alpha.value,
                },
              }),
            ]);
        },
      })
    );
    await settleColoring();
    expect(wrapper.get('[data-testid="sample"]').attributes('style')).toContain(
      'background-color: rgb(255, 255, 255)'
    );

    imageID.value = streaming.imageID;
    await settleColoring();
    expect(wrapper.get('[data-testid="preset"]').text()).toBe('Grayscale');
    expect(wrapper.get('[data-testid="sample"]').attributes('style')).toContain(
      'background-color: rgb(0, 0, 0)'
    );

    sampleValue.value = 100;
    streaming.image
      .getPointData()
      .getScalars()
      .setData(Float32Array.from([0, 100, 200]));
    streaming.image.modified();
    await settleColoring();
    expect(wrapper.get('[data-testid="sample"]').attributes('style')).toContain(
      'background-color: rgb(128, 128, 128)'
    );

    store.setDefaults(streaming.imageID, {});
    useImageCacheStore().imageById[streaming.imageID].loaded.value = true;
    await settleColoring();
    expect(wrapper.get('[data-testid="preset"]').text()).toBe(
      'Adaptive-Balanced'
    );
  });
});
