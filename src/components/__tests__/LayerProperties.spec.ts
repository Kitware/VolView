import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import LayerProperties from '@/src/components/LayerProperties.vue';
import DisplayRangeControl from '@/src/components/DisplayRangeControl.vue';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useImageStatsStore } from '@/src/store/image-stats';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useViewStore } from '@/src/store/views';
import { useLayerColoringStore } from '@/src/store/view-configs/layers';

enableAutoUnmount(afterEach);

const layer = { id: 'base::pet', selection: 'pet' };

function seatImage(
  id: string,
  values = [-5, 0, 4.5, 20],
  numberOfComponents = 1
) {
  useImageStatsStore().stats[id] = {
    scalarMin: Math.min(...values),
    scalarMax: Math.max(...values),
    autoRangeValues: {},
  };
  const image = vtkImageData.newInstance();
  image.setDimensions(2, 2, 1);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: 'scalars',
      numberOfComponents,
      values: Float64Array.from(values),
    })
  );
  const cache = useImageCacheStore();
  if (cache.getVtkImageData(id)) cache.updateVTKImageData(id, image);
  else cache.addVTKImageData(image, id, { id });
}

const views2D = () =>
  useViewStore()
    .getAllViews()
    .filter((view) => view.type === '2D');

const mountControls = () =>
  mount(LayerProperties, {
    props: { layer },
    global: { plugins: [createVuetify()] },
  });

async function draftRange(
  wrapper: ReturnType<typeof mountControls>,
  min: string,
  max: string
) {
  await wrapper.get('[data-testid="layer-range-min"] input').setValue(min);
  await wrapper.get('[data-testid="layer-range-max"] input').setValue(max);
}

function appliedRange(wrapper: ReturnType<typeof mountControls>) {
  return ['min', 'max'].map((endpoint) =>
    wrapper
      .get(`[data-testid="layer-range-${endpoint}"] input`)
      .attributes('title')
  );
}

beforeEach(() => {
  setActivePinia(createPinia());
  [layer.id, layer.selection, 'base'].forEach((id) => seatImage(id));
  useLayersStore().parentToLayers.base = [layer];
  useViewStore().setDataForAllViews('base');
  useLayerColoringStore().updateDisplayConfig(layer.id, {
    preset: 'DICOM Hot Iron',
    mappingRange: [0, 10],
    opacity: 0.5,
  });
});

describe('LayerProperties', () => {
  it('enables transparent background by default and retains its selection through other edits', async () => {
    const wrapper = mountControls();
    const toggle = wrapper.get<HTMLInputElement>(
      '[data-testid="layer-transparent-background"] input'
    );
    expect(toggle.element.checked).toBe(true);
    expect(
      wrapper.get('[data-testid="layer-transparent-background"]').text()
    ).toContain('Transparent background');
    await toggle.setValue(false);
    await draftRange(wrapper, '-2.75', '6.25');
    expect(toggle.element.checked).toBe(false);
    await toggle.setValue(true);
    expect(toggle.element.checked).toBe(true);
  });

  it.each([2, 3, 4])(
    'keeps opacity and visibility usable for %s-component overlays',
    (numberOfComponents) => {
      seatImage(
        layer.id,
        Array.from({ length: 4 * numberOfComponents }, (_, index) => index),
        numberOfComponents
      );
      const wrapper = mountControls();
      for (const selector of [
        '[data-testid="layer-colormap"] input',
        '[data-testid="layer-range-min"] input',
        '[data-testid="layer-range-max"] input',
        '[data-testid="layer-transparent-background"] input',
      ]) {
        expect(wrapper.get<HTMLInputElement>(selector).element.disabled).toBe(
          true
        );
      }
      expect(
        wrapper.get<HTMLButtonElement>('[data-testid="layer-contrast"]').element
          .disabled
      ).toBe(true);
      expect(
        wrapper.get<HTMLButtonElement>('[data-testid="layer-visibility"]')
          .element.disabled
      ).toBe(false);
      expect(
        wrapper.get<HTMLInputElement>(
          '[data-testid="layer-opacity-slider"] input'
        ).element.disabled
      ).toBe(false);
      const controls = wrapper.get('.colormap-control');
      expect(controls.attributes('tabindex')).toBe('0');
      const descriptionId = controls.attributes('aria-describedby');
      expect(descriptionId).toBeTruthy();
      expect(document.getElementById(descriptionId!)?.textContent).toContain(
        'Color map, range, contrast, and background transparency require a single-component overlay.'
      );
    }
  );

  it('keeps loaded overlay controls editable in a 3D-only layout', async () => {
    useViewStore().switchToNamedLayout('3D Only');
    const wrapper = mountControls();
    for (const selector of [
      '[data-testid="layer-colormap"] input',
      '[data-testid="layer-range-min"] input',
      '[data-testid="layer-range-max"] input',
      '[data-testid="layer-transparent-background"] input',
      '[data-testid="layer-opacity-slider"] input',
    ])
      expect(wrapper.get<HTMLInputElement>(selector).element.disabled).toBe(
        false
      );
    const opacity = wrapper.get(
      '[data-testid="layer-opacity-slider"] [role="slider"]'
    );
    await opacity.trigger('keydown', { key: 'ArrowLeft' });
    expect(opacity.attributes('aria-valuenow')).toBe('0.49');
    await draftRange(wrapper, '-2.75', '6.25');
    expect(wrapper.find('[data-testid="layer-range-apply"]').exists()).toBe(
      false
    );

    expect(wrapper.find('[data-testid="layer-range-status"]').exists()).toBe(
      false
    );
    expect(appliedRange(wrapper)).toEqual(['-2.75', '6.25']);
  });

  it.each([
    ['', '5', 'Enter both Min and Max.'],
    ['NaN', '5', 'Min and Max must be finite numbers.'],
    ['-Infinity', '5', 'Min and Max must be finite numbers.'],
    ['1', 'Infinity', 'Min and Max must be finite numbers.'],
    ['5', '5', 'Min must be less than Max.'],
    ['6', '5', 'Min must be less than Max.'],
  ])(
    'explains invalid range %s to %s and keeps the applied range on Enter',
    async (min, max, message) => {
      const wrapper = mountControls();
      await draftRange(wrapper, '', max);
      await wrapper.get('[data-testid="layer-range-min"] input').setValue(min);
      expect(wrapper.get('[data-testid="layer-range-status"]').text()).toBe(
        message
      );
      await wrapper
        .get('[data-testid="layer-range-max"] input')
        .trigger('keydown', { key: 'Enter' });
      expect(appliedRange(wrapper)).toEqual(['0', '10']);
    }
  );

  it.each(['-', '.', '-.', '1e', '1e-'])(
    'keeps incomplete numeric text %s through palette and opacity changes',
    async (draft) => {
      const wrapper = mountControls();
      await wrapper
        .get('[data-testid="layer-range-min"] input')
        .setValue(draft);
      useLayerColoringStore().updateDisplayConfig(layer.id, {
        preset: 'Grayscale',
        opacity: 0.75,
      });
      await wrapper.vm.$nextTick();
      expect(
        wrapper.get<HTMLInputElement>('[data-testid="layer-range-min"] input')
          .element.value
      ).toBe(draft);
      expect(appliedRange(wrapper)).toEqual(['0', '10']);
      expect(
        wrapper
          .get('[data-testid="layer-opacity-slider"] [role="slider"]')
          .attributes('aria-valuenow')
      ).toBe('0.75');
      await draftRange(wrapper, '-25.75', '40.25');
      expect(appliedRange(wrapper)).toEqual(['-25.75', '40.25']);
      await draftRange(wrapper, '-5', '20');
      expect(appliedRange(wrapper)).toEqual(['-5', '20']);
      expect(
        wrapper
          .get('[data-testid="layer-opacity-slider"] [role="slider"]')
          .attributes('aria-valuenow')
      ).toBe('0.75');
    }
  );

  it('updates the displayed range with the slider keyboard controls', async () => {
    const wrapper = mountControls();
    const thumbs = wrapper.findAll(
      '[data-testid="layer-range-slider"] [role="slider"]'
    );
    expect(thumbs).toHaveLength(3);
    const minimumThumb = wrapper.get(
      '[role="slider"][aria-label="Display range minimum"]'
    );
    const maximumThumb = wrapper.get(
      '[role="slider"][aria-label="Display range maximum"]'
    );
    expect(minimumThumb.attributes('tabindex')).toBe('0');
    expect(maximumThumb.attributes('tabindex')).toBe('0');
    await minimumThumb.trigger('keydown', { key: 'ArrowRight' });
    expect(
      wrapper
        .find('[role="slider"][aria-label="Display range minimum"]')
        .exists()
    ).toBe(true);
    expect(
      wrapper
        .find('[role="slider"][aria-label="Display range maximum"]')
        .exists()
    ).toBe(true);
    expect(
      Number(
        wrapper.get<HTMLInputElement>('[data-testid="layer-range-min"] input')
          .element.value
      )
    ).toBeGreaterThan(0);
    expect(appliedRange(wrapper)).not.toEqual(['0', '10']);
  });

  it('displays global controls even when the active view has independent settings', () => {
    const second = views2D()[1];
    const coloring = useLayerColoringStore();
    const config = coloring.getConfig(second.id, layer.id);
    coloring.deserialize(second.id, {
      [layer.id]: {
        layers: {
          ...config,
          transferFunction: { preset: 'Grayscale', mappingRange: [-3, 7] },
          blendConfig: { ...config.blendConfig, opacity: 0.9 },
        },
      },
    });
    useViewStore().setActiveView(second.id);
    const wrapper = mountControls();
    expect(
      wrapper.get<HTMLInputElement>('[data-testid="layer-range-min"] input')
        .element.value
    ).toBe('0');
    expect(
      wrapper.get<HTMLInputElement>('[data-testid="layer-range-max"] input')
        .element.value
    ).toBe('10');
    expect(appliedRange(wrapper)).toEqual(['0', '10']);
    expect(wrapper.get('[data-testid="layer-colormap"]').text()).toContain(
      'DICOM Hot Iron'
    );
    expect(
      wrapper
        .get('[data-testid="layer-opacity-slider"] [role="slider"]')
        .attributes('aria-valuenow')
    ).toBe('0.5');
  });
  it.each([
    [0.123456789, 0.987654321, '0.1235', '0.9877'],
    [1.23456789e-12, 9.87654321e-12, '1.235e-12', '9.877e-12'],
    [1.23456789e12, 9.87654321e12, '1.235e+12', '9.877e+12'],
    [100.00001, 100.00002, '100.00001', '100.00002'],
    [1, 1 + Number.EPSILON, '1', '1.0000000000000002'],
    [Number.MIN_VALUE, Number.MIN_VALUE * 2, '5e-324', '1e-323'],
  ])(
    'displays distinguishable range inputs for %s to %s',
    (min, max, minText, maxText) => {
      seatImage(layer.id, [min, min, max, max]);
      useLayerColoringStore().updateDisplayConfig(layer.id, {
        mappingRange: [min, max],
      });
      const wrapper = mountControls();
      expect(
        wrapper.get<HTMLInputElement>('[data-testid="layer-range-min"] input')
          .element.value
      ).toBe(minText);
      expect(
        wrapper.get<HTMLInputElement>('[data-testid="layer-range-max"] input')
          .element.value
      ).toBe(maxText);
      expect(appliedRange(wrapper)).toEqual([String(min), String(max)]);
      expect(wrapper.find('[data-testid="layer-range-status"]').exists()).toBe(
        false
      );
    }
  );

  it.each([
    ['min', '0.1235', '0.123456789'],
    ['max', '0.9877', '0.987654321'],
  ])(
    'keeps %s rounded on focus and exposes its exact value on hover',
    async (endpoint, rounded, exact) => {
      useLayerColoringStore().updateDisplayConfig(layer.id, {
        mappingRange: [0.123456789, 0.987654321],
      });
      const wrapper = mountControls();
      const input = wrapper.get<HTMLInputElement>(
        `[data-testid="layer-range-${endpoint}"] input`
      );
      expect(input.attributes('title')).toBe(exact);
      expect(input.element.value).toBe(rounded);
      await input.trigger('focus');
      expect(input.element.value).toBe(rounded);
      expect(appliedRange(wrapper)).toEqual(['0.123456789', '0.987654321']);
      await input.trigger('blur');
      expect(input.element.value).toBe(rounded);
      expect(appliedRange(wrapper)).toEqual(['0.123456789', '0.987654321']);
    }
  );

  it('refreshes a valid blurred draft after a window-level round trip and a later preset', async () => {
    const wrapper = mount(DisplayRangeControl, {
      props: {
        modelValue: [0, 200],
        dataRange: [0, 200],
        preset: 'Grayscale',
      },
      global: { plugins: [createVuetify()] },
    });
    const input = wrapper.get<HTMLInputElement>(
      '[data-testid="layer-range-min"] input'
    );
    await input.setValue('0.1');
    const width = 200 - 0.1;
    const level = 0.1 + width / 2;
    await wrapper.setProps({
      modelValue: [level - width / 2, level + width / 2],
    });
    expect(input.element.value).toBe('0.1');
    await input.trigger('blur');
    await wrapper.setProps({ modelValue: [20, 150] });
    expect(input.element.value).toBe('20');
    expect(input.attributes('title')).toBe('20');
  });

  it.each(['min', 'max'])(
    'editing %s retains the exact untouched endpoint and delays formatting until blur',
    async (endpoint) => {
      useLayerColoringStore().updateDisplayConfig(layer.id, {
        mappingRange: [0.123456789, 0.987654321],
      });
      const wrapper = mountControls();
      const input = wrapper.get<HTMLInputElement>(
        `[data-testid="layer-range-${endpoint}"] input`
      );
      await input.trigger('focus');
      await input.setValue('0.54321098700');
      expect(input.element.value).toBe('0.54321098700');
      const exactRange =
        endpoint === 'min'
          ? ['0.543210987', '0.987654321']
          : ['0.123456789', '0.543210987'];
      expect(appliedRange(wrapper)).toEqual(exactRange);
      await input.trigger('blur');
      expect(input.element.value).toBe('0.5432');
      expect(appliedRange(wrapper)).toEqual(exactRange);
    }
  );
});
