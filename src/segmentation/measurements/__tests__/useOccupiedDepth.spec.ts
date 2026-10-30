import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import {
  createOccupiedDepthHandler,
  type MeasurementRequest,
} from '../occupiedDepthHandler';
import {
  useOccupiedDepth,
  type OccupiedDepthRequest,
} from '../useOccupiedDepth';

enableAutoUnmount(afterEach);

function controlledMeasurements() {
  const replies: Array<() => void> = [];
  let fail: () => void = () => {};
  const create = () => {
    const handle = createOccupiedDepthHandler();
    const worker = {
      onmessage: null as Worker['onmessage'],
      onerror: null as Worker['onerror'],
      onmessageerror: null as Worker['onmessageerror'],
      terminate: () => {},
      postMessage(message: MeasurementRequest, transfer: Transferable[]) {
        const snapshot = structuredClone(message, { transfer });
        const response = handle(snapshot);
        const receive = worker.onmessage!;
        replies.push(() =>
          receive.call(
            worker as unknown as Worker,
            new MessageEvent('message', {
              data: response,
            })
          )
        );
      },
    };
    fail = () =>
      worker.onerror?.call(
        worker as unknown as Worker,
        new ErrorEvent('error', { message: 'Measurement device unavailable.' })
      );
    return worker as unknown as Worker;
  };
  return {
    create,
    finish: async () => {
      await nextTick();
      replies.shift()?.();
      await nextTick();
    },
    fail: () => fail(),
  };
}

function mountMeasurement(keepEnabled = false) {
  const request = shallowRef<OccupiedDepthRequest | null>({
    source: {},
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
  const worker = controlledMeasurements();
  const wrapper = mount(
    defineComponent({
      setup() {
        const { accepted, computing, error, stale } = useOccupiedDepth(
          request,
          worker.create,
          keepEnabled ? true : undefined
        );
        return () =>
          h(
            'output',
            { role: 'status' },
            stale.value
              ? `${accepted.value!.counts.join(',')} occupied cells (updating)`
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
  return { request, worker, wrapper };
}

describe('occupied-depth result ownership', () => {
  it('keeps obsolete overlays unavailable until the final selected slab completes', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    const input = request.value!;
    request.value = { ...input, first: 1, last: 4 };
    request.value = { ...input, first: 2, last: 3 };
    await nextTick();
    expect(wrapper.text()).toBe('Measuring occupied depth');
    await worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('Measuring occupied depth');
    await worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('0 occupied cells');
    expect(Array.from(input.mask.values)).toEqual([1, 1, 0, 0, 1, 1]);
  });

  it('keeps a compatible overlay visible and marked stale until the newest edit completes', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    await worker.finish();
    const input = request.value!;
    input.mask.values[0] = 0;
    request.value = { ...input, mask: { ...input.mask } };
    await nextTick();
    expect(wrapper.text()).toBe('4 occupied cells (updating)');
    input.mask.values[1] = 0;
    request.value = { ...input, mask: { ...input.mask } };
    await worker.finish();
    expect(wrapper.text()).toBe('4 occupied cells (updating)');
    await worker.finish();
    expect(wrapper.text()).toBe('2 occupied cells');
  });

  it.each(['source', 'segment', 'grid'] as const)(
    'removes the previous overlay while a different %s is measured',
    async (field) => {
      const { request, worker, wrapper } = mountMeasurement();
      await worker.finish();
      request.value = {
        ...request.value!,
        [field]: field === 'source' ? {} : 'replacement',
      };
      await nextTick();
      expect(wrapper.text()).toBe('Measuring occupied depth');
      await worker.finish();
      expect(wrapper.text()).toBe('4 occupied cells');
    }
  );

  it('keeps the worker snapshot through a temporary invalid crop while highlighting stays enabled', async () => {
    const { request, worker, wrapper } = mountMeasurement(true);
    const input = request.value!;
    await worker.finish();
    request.value = null;
    await nextTick();
    expect(wrapper.text()).toBe('Unavailable');
    input.mask.values[0] = 0;
    request.value = input;
    await worker.finish();
    expect(wrapper.text()).toBe('4 occupied cells');
    request.value = { ...input, mask: { ...input.mask } };
    await worker.finish();
    expect(wrapper.text()).toBe('3 occupied cells');
  });

  it('does not restore removed-source measurements when an old reply arrives', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    request.value = null;
    await worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('Unavailable');
  });

  it('keeps the prepared snapshot across slabs and refreshes announced in-place edits', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    const input = request.value!;
    await worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('4 occupied cells');

    input.mask.values[0] = 0;
    request.value = { ...input, last: 4 };
    await worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('3 occupied cells');

    request.value = { ...request.value!, mask: { ...input.mask } };
    await worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('2 occupied cells');
    expect(Array.from(input.mask.values)).toEqual([0, 1, 0, 0, 1, 1]);
  });

  it('moves a replacement crop to its source column and rechecks source geometry', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    const input = request.value!;
    await worker.finish();
    request.value = {
      ...input,
      dimensions: [2, 6, 1],
      mask: { ...input.mask, extent: [1, 1, 0, 5, 0, 0] },
    };
    await worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('0,4 occupied cells');

    request.value = { ...request.value, dimensions: [1, 6, 1] };
    await worker.finish();
    await nextTick();
    expect(wrapper.text()).toContain('align with the source');
  });

  it('ignores an old reply after highlighting restarts with the same mask', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    const input = request.value!;
    request.value = null;
    request.value = { ...input, first: 1, last: 1 };
    await worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('Measuring occupied depth');
    await worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('1 occupied cells');
  });

  it('does not reuse the prior mask after an invalid replacement', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    const input = request.value!;
    await worker.finish();
    const mask = { ...input.mask, values: new Uint8Array([2, 1, 0, 0, 1, 1]) };
    request.value = { ...input, mask };
    await worker.finish();
    await nextTick();
    expect(wrapper.text()).toContain('binary mask');

    request.value = { ...input, mask, first: 1, last: 1 };
    await worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('Occupied depth requires a binary mask.');
  });

  it('ends pending status on a real failure and can measure the next input', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    const input = request.value!;
    worker.fail();
    await nextTick();
    expect(wrapper.text()).toBe('Measurement device unavailable.');
    await worker.finish();
    request.value = { ...input, first: 1, last: 1 };
    await worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('1 occupied cells');
  });
});
