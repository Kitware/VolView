import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

// The REAL layers store, image cache and `useErrorMessage` wrapper run here.
// An earlier suite mocked `addLayer` itself, which hid the bug this file
// guards: `addLayer` must return the built layer id on success (and
// `undefined` only when a build throws and `useErrorMessage` swallows it).
const { ensureSameSpace } = vi.hoisted(() => ({ ensureSameSpace: vi.fn() }));
// eslint-disable-next-line no-restricted-syntax -- resampling runs in wasm; unavailable in the node test environment
vi.mock('@/src/io/resample/resample', () => ({ ensureSameSpace }));

import { useLayersStore } from '@/src/store/datasets-layers';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';

// A unit-spacing cube at `origin`, so its bounds are the numbers the overlap
// check reads: an n-wide cube at o spans [o, o + n - 1] on every axis.
const seatImage = (id: string, origin: number, size = 3) => {
  const image = vtkImageData.newInstance();
  image.setOrigin([origin, origin, origin]);
  image.setDimensions(size, size, size);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: 'scalars',
      numberOfComponents: 1,
      values: new Uint8Array(size ** 3),
    })
  );
  return useImageCacheStore().addVTKImageData(image, id, { id });
};

const cached = (id: string) => id in useImageCacheStore().imageById;

const seatOverlappingPair = () => {
  seatImage('parent', 0);
  seatImage('source', 0);
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  // ensureSameSpace echoes the source image; identity is enough here.
  ensureSameSpace.mockImplementation(
    async (_parent: unknown, source: unknown) => source
  );
});

describe('useLayersStore.addLayer return contract', () => {
  it('returns the built layer id when a valid pair overlaps', async () => {
    seatOverlappingPair();
    const store = useLayersStore();

    const id = await store.addLayer('parent', 'source');

    expect(id).toBe('parent::source');
    expect(store.getLayers('parent')).toHaveLength(1);
    expect(cached('parent::source')).toBe(true);
  });

  it('returns undefined and removes the provisional layer when the build fails', async () => {
    // Non-intersecting bounds: `_addLayer` deletes its provisional layer and
    // throws; `useErrorMessage` swallows the throw and resolves to `undefined`.
    seatImage('parent', 0, 2);
    seatImage('source', 5, 2);
    const store = useLayersStore();

    const id = await store.addLayer('parent', 'source');

    expect(id).toBeUndefined();
    expect(store.getLayers('parent')).toHaveLength(0);
    expect(cached('parent::source')).toBe(false);
    expect(useMessageStore().messages[0].options.details).toContain(
      'no overlap in physical space'
    );
  });
});

describe('useLayersStore.remove', () => {
  beforeEach(() => {
    seatOverlappingPair();
  });

  it('removing a base image prunes and disposes the layers it owns', async () => {
    // Removing a parent clears its parentToLayers entry and evicts each
    // resampled image it owns from the cache.
    const store = useLayersStore();
    await store.addLayer('parent', 'source');

    store.remove('parent');

    expect(store.getLayers('parent')).toHaveLength(0);
    expect(cached('parent::source')).toBe(false);
  });

  it('removing a layer source prunes it from every parent layer list', async () => {
    const store = useLayersStore();
    await store.addLayer('parent', 'source');

    store.remove('source');

    expect(store.getLayers('parent')).toHaveLength(0);
    expect(cached('parent::source')).toBe(false);
  });
});
