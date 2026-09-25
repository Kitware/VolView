import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, nextTick, ref } from 'vue';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import ScalarProbe from '@/src/components/tools/ScalarProbe.vue';
import ProbeView from '@/src/components/ProbeView.vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import { CurrentImageInjectionKey } from '@/src/composables/useCurrentImage';
import { useLayersStore } from '@/src/store/datasets-layers';
import {
  activateAppPinia,
  addMask,
  seatImage,
  seedVoxel,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

enableAutoUnmount(afterEach);

const mountProbe = () => {
  const actor = vtkActor.newInstance();
  const rep = { actor } as unknown as InstanceType<
    typeof ScalarProbe
  >['$props']['baseRep'];
  const picker = {
    setPickFromList: vi.fn(),
    setPickList: vi.fn(),
    pick: vi.fn(),
    getActors: () => [actor],
    getPointIJK: () => [1, 0, 0],
    delete: () => actor.delete(),
  };
  const events = new Map<string, (event?: unknown) => void>();
  const subscribe = (name: string) => (callback: (event?: unknown) => void) => {
    events.set(name, callback);
    return { unsubscribe: () => events.delete(name) };
  };
  const wrapper = mount(ScalarProbe, {
    props: { baseRep: rep, layerReps: [rep], createPicker: () => picker },
    slots: { default: () => h(ProbeView) },
    global: {
      provide: {
        [CurrentImageInjectionKey as symbol]: { imageID: ref('ct') },
        [VtkViewContext as symbol]: {
          renderer: {},
          interactor: {
            onMouseMove: subscribe('move'),
            onPointerLeave: subscribe('leave'),
          },
        },
      },
      stubs: {
        VCard: { template: '<div><slot /></div>' },
        VCardText: { template: '<div><slot /></div>' },
      },
    },
  });
  return {
    wrapper,
    move: async () => {
      events.get('move')!({ position: { x: 10, y: 20 } });
      await nextTick();
    },
    leave: async () => {
      events.get('leave')!();
      await nextTick();
    },
    displayedSamples: () =>
      wrapper
        .findAll('.probe-value-display .d-flex')
        .map((row) => row.findAll('span').map((span) => span.text())),
  };
};

describe('ScalarProbe segment samples', () => {
  beforeEach(async () => {
    activateAppPinia();
    await seatImage('ct', {
      name: 'CT',
      dimensions: [3, 1, 1],
      values: new Float32Array([-100, 42, 100]),
    });
    await seatImage('overlay', {
      name: 'Overlay',
      dimensions: [3, 1, 1],
    });
    await useLayersStore().addLayer('ct', 'overlay');
  });

  it('displays the covering segment beside the CT, the position, and a zero image layer', async () => {
    seedVoxel(addMask('ct', 'Liver'), [1, 0, 0]);
    const probe = mountProbe();
    await probe.move();
    expect(probe.displayedSamples()).toEqual([
      ['Segment', 'Liver'],
      ['Overlay', '0'],
      ['CT', '42'],
      ['Position', '1, 0, 0'],
    ]);
    await probe.leave();
    expect(probe.wrapper.find('.probe-value-display').exists()).toBe(false);
  });

  it('names every overlapping segment under one heading', async () => {
    ['First', 'Second'].forEach((name) =>
      seedVoxel(addMask('ct', name), [1, 0, 0])
    );
    const probe = mountProbe();
    await probe.move();
    expect(probe.displayedSamples()).toEqual([
      ['Segments', 'First, Second'],
      ['Overlay', '0'],
      ['CT', '42'],
      ['Position', '1, 0, 0'],
    ]);
  });

  it('names a covering segment that has no name', async () => {
    seedVoxel(addMask('ct', ''), [1, 0, 0]);
    const probe = mountProbe();
    await probe.move();
    expect(probe.displayedSamples()[0]).toEqual(['Segment', '(no name)']);
  });
});
