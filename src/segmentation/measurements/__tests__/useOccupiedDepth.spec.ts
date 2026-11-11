import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import vtkLabelMap from '@/src/vtk/LabelMap';
import {
  measureOccupiedDepth,
  type OccupiedDepthInput,
} from '../occupiedDepth';
import {
  useOccupiedDepth,
  type OccupiedDepthRequest,
} from '../useOccupiedDepth';

enableAutoUnmount(afterEach);

// Answers in call order when told to, measuring the mask as it was sent.
function controlledMeasurer() {
  const replies: Array<(failure?: Error) => void> = [];
  const state = { releases: 0 };
  const measure = (input: OccupiedDepthInput) => {
    const values = input.mask.values.slice();
    return new Promise<Error | undefined>((resolve) =>
      replies.push(resolve)
    ).then((failure) => {
      if (failure) throw failure;
      return measureOccupiedDepth({
        ...input,
        mask: { ...input.mask, values },
      });
    });
  };
  return {
    state,
    create: () => ({ measure, release: () => state.releases++ }),
    finish: async (failure?: Error) => {
      // Lets a just-changed request reach the measurer first.
      await flushPromises();
      replies.shift()?.(failure);
      await flushPromises();
    },
  };
}

function mountMeasurement() {
  const request = shallowRef<OccupiedDepthRequest | null>({
    source: {},
    maskImage: vtkLabelMap.newInstance(),
    segment: 'segment',
    grid: 'grid',
    dimensions: [1, 6, 1],
    axis: 1,
    first: 0,
    last: 5,
    mask: {
      values: new Uint8Array([1, 1, 0, 0, 1, 1]),
      dimensions: [1, 6, 1],
      extent: [0, 0, 0, 5, 0, 0],
    },
  });
  const measurer = controlledMeasurer();
  const wrapper = mount(
    defineComponent({
      setup() {
        const { accepted, computing, error } = useOccupiedDepth(
          request,
          measurer.create
        );
        return () =>
          h(
            'output',
            { role: 'status' },
            computing.value && accepted.value
              ? `${accepted.value.counts.join(',')} occupied cells (updating)`
              : computing.value
                ? 'Measuring occupied depth'
                : (error.value ??
                  (accepted.value
                    ? `${accepted.value.counts.join(',')} occupied cells`
                    : 'Unavailable'))
          );
      },
    })
  );
  return { request, measurer, wrapper };
}

describe('occupied-depth result ownership', () => {
  it('keeps obsolete overlays unavailable until the final selected slab completes', async () => {
    const { request, measurer, wrapper } = mountMeasurement();
    const input = request.value!;
    request.value = { ...input, first: 1, last: 4 };
    request.value = { ...input, first: 2, last: 3 };
    await nextTick();
    expect(wrapper.text()).toBe('Measuring occupied depth');
    await measurer.finish();
    expect(wrapper.text()).toBe('Measuring occupied depth');
    await measurer.finish();
    expect(wrapper.text()).toBe('0 occupied cells');
  });

  it('keeps a compatible overlay visible and marked stale until the newest edit completes', async () => {
    const { request, measurer, wrapper } = mountMeasurement();
    await measurer.finish();
    const input = request.value!;
    input.mask.values[0] = 0;
    request.value = { ...input, mask: { ...input.mask } };
    await nextTick();
    expect(wrapper.text()).toBe('4 occupied cells (updating)');
    input.mask.values[1] = 0;
    request.value = { ...input, mask: { ...input.mask } };
    await measurer.finish();
    expect(wrapper.text()).toBe('4 occupied cells (updating)');
    await measurer.finish();
    expect(wrapper.text()).toBe('2 occupied cells');
  });

  it.each(['source', 'segment', 'grid'] as const)(
    'removes the previous overlay while a different %s is measured',
    async (field) => {
      const { request, measurer, wrapper } = mountMeasurement();
      await measurer.finish();
      request.value = {
        ...request.value!,
        [field]: field === 'source' ? {} : 'replacement',
      };
      await nextTick();
      expect(wrapper.text()).toBe('Measuring occupied depth');
      await measurer.finish();
      expect(wrapper.text()).toBe('4 occupied cells');
    }
  );

  it('releases the worker when the request is withdrawn and ignores its late reply', async () => {
    const { request, measurer, wrapper } = mountMeasurement();
    const input = request.value!;
    request.value = null;
    await measurer.finish();
    expect(wrapper.text()).toBe('Unavailable');
    expect(measurer.state.releases).toBe(1);

    request.value = { ...input, first: 1, last: 1 };
    await nextTick();
    expect(wrapper.text()).toBe('Measuring occupied depth');
    await measurer.finish();
    expect(wrapper.text()).toBe('1 occupied cells');
  });

  it('shows a failed measurement and measures the next request', async () => {
    const { request, measurer, wrapper } = mountMeasurement();
    await measurer.finish(new Error('Measurement device unavailable.'));
    expect(wrapper.text()).toBe('Measurement device unavailable.');
    request.value = { ...request.value!, first: 1, last: 1 };
    await measurer.finish();
    expect(wrapper.text()).toBe('1 occupied cells');
  });
});
