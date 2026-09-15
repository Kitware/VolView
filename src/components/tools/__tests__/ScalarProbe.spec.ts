import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import ScalarProbe from '@/src/components/tools/ScalarProbe.vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useProbeStore } from '@/src/store/probe';

import * as currentImage from '@/src/composables/useCurrentImage';
import * as vtkEvent from '@/src/composables/onVTKEvent';
import vtkPointPicker from '@kitware/vtk.js/Rendering/Core/PointPicker';
import * as imageCache from '@/src/store/image-cache';
import * as segments from '@/src/store/segments';
import * as segmentations from '@/src/store/segmentations';

const state = {
  current: {} as ReturnType<typeof currentImage.useCurrentImage>,
  masks: [] as { id: string; image: vtkImageData }[],
  events: {} as Record<string, (event: unknown) => void>,
};

function image(values: number[], components = 1) {
  const result = vtkImageData.newInstance();
  result.setDimensions(3, 1, 1);
  result.getPointData().setScalars(
    vtkDataArray.newInstance({
      values: new Float32Array(values),
      numberOfComponents: components,
    })
  );
  return result;
}

function probe() {
  const rep = {} as InstanceType<typeof ScalarProbe>['$props']['baseRep'];
  const wrapper = mount(ScalarProbe, {
    props: {
      baseRep: rep,
      layerReps: [rep],
      segmentReps: state.masks.map(() => rep),
    },
    global: {
      provide: { [VtkViewContext as symbol]: { renderer: {}, interactor: {} } },
    },
  });
  state.events.onMouseMove({ position: { x: 10, y: 20 } });
  const result = useProbeStore().probeData;
  wrapper.unmount();
  return result;
}

describe('ScalarProbe segment samples', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.restoreAllMocks();
    setActivePinia(createPinia());
    state.current = {
      currentImageID: ref('ct'),
      currentImageData: ref(image([-100, 42, 100])),
      currentImageMetadata: ref({ name: 'CT' }),
      currentLayers: ref([{ id: 'overlay', selection: 'overlay' }]),
    } as ReturnType<typeof currentImage.useCurrentImage>;
    state.masks = [];
    state.events = {};
    vi.spyOn(currentImage, 'useCurrentImage').mockImplementation(
      () => state.current
    );
    vi.spyOn(vtkEvent, 'onVTKEvent').mockImplementation(
      (_target, name, callback) => {
        state.events[name] = callback;
        return { stop: () => {} };
      }
    );
    const picker = { ...vtkPointPicker.newInstance() };
    vi.spyOn(picker, 'pick').mockImplementation(() => {});
    vi.spyOn(picker, 'getActors').mockReturnValue([
      {} as ReturnType<typeof picker.getActors>[number],
    ]);
    vi.spyOn(picker, 'getPointIJK').mockReturnValue([1, 0, 0]);
    vi.spyOn(vtkPointPicker, 'newInstance').mockReturnValue(picker);
    const cache = imageCache.useImageCacheStore();
    vi.spyOn(cache, 'getImageMetadata').mockReturnValue({
      name: 'Overlay',
    } as ReturnType<typeof cache.getImageMetadata>);
    vi.spyOn(cache, 'getVtkImageData').mockReturnValue(image([0, 0, 0]));
    const registry = segments.useSegmentStore();
    vi.spyOn(registry.segments, 'appearanceOf').mockImplementation(
      (id) =>
        ({ name: id }) as ReturnType<typeof registry.segments.appearanceOf>
    );
    const store = segmentations.useSegmentationStore();
    vi.spyOn(store, 'maskLayersForImage').mockImplementation(() =>
      state.masks.map(({ id }) => ({ maskId: id, stackIndex: 0 }))
    );
    vi.spyOn(store, 'getMask').mockImplementation(
      (id) => ({ segmentId: id }) as ReturnType<typeof store.getMask>
    );
    vi.spyOn(store, 'findMaskVoxels').mockImplementation(
      (id) =>
        ({
          exists: () => true,
          image: () => state.masks.find((mask) => mask.id === id)!.image,
        }) as ReturnType<typeof store.findMaskVoxels>
    );
    vi.spyOn(store, 'labelmapDescriptorByMask', 'get').mockImplementation(() =>
      Object.fromEntries(
        state.masks.map(({ id }) => [
          id,
          { value: 1, name: id, color: [255, 0, 0, 255], visible: true },
        ])
      )
    );
  });

  it('omits empty mask voxels while retaining the occupied segment, CT, position, and zero image layer', () => {
    state.masks = [
      { id: 'Liver', image: image([0, 1, 0]) },
      { id: 'Kidney', image: image([1, 0, 0]) },
      { id: 'Spleen', image: image([0, 0, 1]) },
    ];
    const result = probe();
    expect(Array.from(result!.pos)).toEqual([1, 0, 0]);
    expect(result!.samples).toEqual([
      { id: 'Liver', name: 'Liver', displayValues: ['Liver'] },
      { id: 'overlay', name: 'Overlay', displayValues: [0] },
      { id: 'ct', name: 'CT', displayValues: [42] },
    ]);
  });

  it('retains genuinely overlapping segments and masks with any occupied component', () => {
    state.masks = [
      { id: 'First', image: image([0, 1, 0]) },
      { id: 'Second', image: image([0, 0, 0, 1, 0, 0], 2) },
      { id: 'Empty', image: image([1, 0, 0, 0, 0, 1], 2) },
    ];
    expect(probe()!.samples.slice(0, 2)).toEqual([
      { id: 'First', name: 'First', displayValues: ['First'] },
      { id: 'Second', name: 'Second', displayValues: ['Background', 'Second'] },
    ]);
    expect(probe()!.samples.map(({ id }) => id)).toEqual([
      'First',
      'Second',
      'overlay',
      'ct',
    ]);
  });
});
