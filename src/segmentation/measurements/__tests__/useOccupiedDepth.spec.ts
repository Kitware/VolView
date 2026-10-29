import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import {
  createOccupiedDepthMeasurer,
  type OccupiedDepthInput,
} from '../occupiedDepth';
import type { MeasurementRequest } from '../occupiedDepth.worker';
import { useOccupiedDepth } from '../useOccupiedDepth';

enableAutoUnmount(afterEach);

function controlledMeasurements() {
  const replies: Array<() => void> = [];
  let fail: () => void = () => {};
  const create = () => {
    let validity: Uint8Array | undefined;
    let measure: ReturnType<typeof createOccupiedDepthMeasurer> | undefined;
    const worker = {
      onmessage: null as Worker['onmessage'],
      onerror: null as Worker['onerror'],
      onmessageerror: null as Worker['onmessageerror'],
      terminate: () => {},
      postMessage(message: MeasurementRequest, transfer: Transferable[]) {
        const snapshot = structuredClone(message, { transfer });
        if (snapshot.source) validity = snapshot.source.validity;
        let response;
        try {
          if (snapshot.mask) {
            measure = undefined;
            measure = createOccupiedDepthMeasurer(snapshot.mask);
          }
          if (!measure) throw new Error('No prepared occupied-depth mask.');
          response = {
            result: measure({ ...snapshot.input, validity }),
          };
        } catch (cause) {
          response = {
            error: cause instanceof Error ? cause.message : String(cause),
          };
        }
        const receive = worker.onmessage!;
        replies.push(() =>
          receive.call(
            worker as unknown as Worker,
            new MessageEvent('message', {
              data: { id: snapshot.id, ...response },
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
    finish: () => replies.shift()?.(),
    fail: () => fail(),
  };
}

function mountMeasurement() {
  const request = shallowRef<OccupiedDepthInput | null>({
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
        const { accepted, computing, error } = useOccupiedDepth(
          request,
          worker.create
        );
        return () =>
          h(
            'output',
            { role: 'status' },
            computing.value
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
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('Measuring occupied depth');
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('0 occupied cells');
    expect(Array.from(input.mask.values)).toEqual([1, 1, 0, 0, 1, 1]);
  });

  it('does not restore removed-source measurements when an old reply arrives', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    request.value = null;
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('Unavailable');
  });

  it('keeps the prepared snapshot across slabs and refreshes announced in-place edits', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    const input = request.value!;
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('4 occupied cells');

    input.mask.values[0] = 0;
    request.value = { ...input, last: 4 };
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('3 occupied cells');

    request.value = { ...request.value!, mask: { ...input.mask } };
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('2 occupied cells');
    expect(Array.from(input.mask.values)).toEqual([0, 1, 0, 0, 1, 1]);
  });

  it('moves a replacement crop to its source column and rechecks source geometry', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    const input = request.value!;
    worker.finish();
    request.value = {
      ...input,
      dimensions: [2, 6, 1],
      mask: { ...input.mask, extent: [1, 1, 0, 5, 0, 0] },
    };
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('0,4 occupied cells');

    request.value = { ...request.value, dimensions: [1, 6, 1] };
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toContain('align with the source');
  });

  it('refreshes source support and clears it when the replacement has no padding', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    const input = request.value!;
    worker.finish();
    request.value = {
      ...input,
      validity: new Uint8Array([0, 1, 1, 1, 1, 1]),
    };
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('0 occupied cells');

    request.value = { ...input };
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('4 occupied cells');
  });

  it('ignores an old reply after highlighting restarts with the same mask', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    const input = request.value!;
    request.value = null;
    request.value = { ...input, first: 1, last: 1 };
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('Measuring occupied depth');
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('1 occupied cells');
  });

  it('does not reuse the prior mask after an invalid replacement', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    const input = request.value!;
    worker.finish();
    const mask = { ...input.mask, values: new Uint8Array([2, 1, 0, 0, 1, 1]) };
    request.value = { ...input, mask };
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toContain('binary mask');

    request.value = { ...input, mask, first: 1, last: 1 };
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('No prepared occupied-depth mask.');
  });

  it('ends pending status on a real failure and can measure the next input', async () => {
    const { request, worker, wrapper } = mountMeasurement();
    const input = request.value!;
    worker.fail();
    await nextTick();
    expect(wrapper.text()).toBe('Measurement device unavailable.');
    worker.finish();
    request.value = { ...input, first: 1, last: 1 };
    worker.finish();
    await nextTick();
    expect(wrapper.text()).toBe('1 occupied cells');
  });
});
