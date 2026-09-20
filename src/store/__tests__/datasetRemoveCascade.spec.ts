import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  boundMasks,
  mintSegment,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useDatasetStore } from '@/src/store/datasets';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';
import { useCropStore } from '@/src/store/tools/crop';

// Bind an existing (default-layout) view to a dataset via the public API —
// `addView` is internal, but every fresh store already seats slot views.
const bindFirstViewTo = (dataID: string) => {
  const viewStore = useViewStore();
  const [viewID] = viewStore.viewIDs;
  viewStore.setDataForView(viewID, dataID);
  return viewID;
};

// ---------------------------------------------------------------------------
// Delete-a-dataset-then-save, the whole cascade.
//
// Removing a dataset must clean EVERY store that references it SYNCHRONOUSLY —
// before `remove()` returns — so a `serialize()` on the same tick (what
// applying a job "Open" result does) can never snapshot a dangling reference.
//
// Note the absence of `await nextTick()` in these tests: the whole cascade is
// synchronous, so a same-tick serialize never sees orphaned ids.
// ---------------------------------------------------------------------------

const seatImage = (id: string, name: string) => {
  const img = vtkImageData.newInstance();
  img.setDimensions(2, 2, 2);
  const scalars = vtkDataArray.newInstance({
    name: 'scalars',
    numberOfComponents: 1,
    values: new Uint8Array(8),
  });
  img.getPointData().setScalars(scalars);
  return useImageCacheStore().addVTKImageData(img, name, { id });
};

const makeRuler = (imageID: string) =>
  ({
    firstPoint: [1, 1, 1],
    secondPoint: [2, 2, 2],
    imageID,
    name: 'Ruler',
    frameOfReference: {
      planeNormal: [1, 0, 0],
      planeOrigin: [0, 0, 0],
    },
    slice: 23,
    placing: false,
  }) as never;

const seatMask = (imageId: string) => {
  const segmentations = useSegmentationStore();
  const segmentationId = segmentations.ensureSegmentationForImage(imageId).id;
  const maskId = segmentations.createMask(segmentationId, mintSegment()).id;
  segmentations.maskVoxels(maskId).materialize();
  return { segmentationId, maskId };
};

describe('dataset remove — synchronous reference cascade', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('clears segment masks whose parent image was removed', () => {
    seatImage('img-1', 'CT');
    // The store subscribes to image deletion on setup, so seat it first.
    useSegmentationStore();
    const { maskId } = seatMask('img-1');
    expect(boundMasks().map((mask) => mask.id)).toContain(maskId);

    useDatasetStore().remove('img-1');

    expect(boundMasks()).toEqual([]);
  });

  it('clears ALL segment masks when an image has several (no splice-skip)', () => {
    seatImage('img-1', 'CT');
    const segmentations = useSegmentationStore();
    const first = seatMask('img-1');
    const rest = ['A', 'B'].map((name) => {
      const segment = segmentations.createMask(
        first.segmentationId,
        mintSegment({
          name,
        })
      );
      segmentations.maskVoxels(segment.id).materialize();
      return segment.id;
    });
    const maskIds = [first.maskId, ...rest];
    expect(
      boundMasks()
        .map((mask) => mask.id)
        .sort()
    ).toEqual([...maskIds].sort());

    useDatasetStore().remove('img-1');

    expect(boundMasks()).toEqual([]);
  });

  it('removes the segmentation and its masks with the parent image', () => {
    seatImage('img-1', 'CT');
    const segmentations = useSegmentationStore();
    const { segmentationId, maskId } = seatMask('img-1');
    expect(boundMasks().map((mask) => mask.id)).toContain(maskId);

    useDatasetStore().remove('img-1');

    expect(segmentations.getSegmentationForImage('img-1')).toBeFalsy();
    expect(segmentations.segmentations).not.toHaveProperty(segmentationId);
    expect(boundMasks()).toEqual([]);
  });

  it('leaves another image segmentation intact', () => {
    seatImage('img-1', 'CT');
    seatImage('img-2', 'PET');
    const segmentations = useSegmentationStore();
    seatMask('img-1');
    const kept = seatMask('img-2');

    useDatasetStore().remove('img-1');

    expect(segmentations.getSegmentationForImage('img-2')).toBeTruthy();
    expect(boundMasks().map((mask) => mask.id)).toEqual([kept.maskId]);
  });

  it('clears annotation tools bound to the removed image', () => {
    seatImage('img-1', 'CT');
    const rulerStore = useRulerStore();
    rulerStore.addRuler(makeRuler('img-1'));

    useDatasetStore().remove('img-1');

    expect(rulerStore.serializeTools().tools).toEqual([]);
  });

  it('unbinds views pointing at the removed dataset', () => {
    seatImage('img-1', 'CT');
    const viewStore = useViewStore();
    bindFirstViewTo('img-1');
    expect(viewStore.getViewsForData('img-1')).toHaveLength(1);

    useDatasetStore().remove('img-1');

    expect(viewStore.getViewsForData('img-1')).toEqual([]);
  });

  it('detaches consumers before disposing the removed image', async () => {
    seatImage('img-1', 'CT');
    const imageCacheStore = useImageCacheStore();
    const image = imageCacheStore.imageById['img-1'];
    const dispose = vi.spyOn(image, 'dispose');
    const viewStore = useViewStore();
    bindFirstViewTo('img-1');

    useDatasetStore().remove('img-1');

    expect(imageCacheStore.imageById).not.toHaveProperty('img-1');
    expect(viewStore.getViewsForData('img-1')).toEqual([]);
    expect(dispose).not.toHaveBeenCalled();

    await nextTick();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('drops crop state keyed by the removed image', () => {
    seatImage('img-1', 'CT');
    const cropStore = useCropStore();
    cropStore.setCropping('img-1', {
      Sagittal: [0, 1],
      Coronal: [0, 1],
      Axial: [0, 1],
    });
    expect('img-1' in cropStore.croppingByImageID).toBe(true);

    useDatasetStore().remove('img-1');

    expect('img-1' in cropStore.croppingByImageID).toBe(false);
  });

  it('removes the records of a deleted image and keeps their type', () => {
    seatImage('img-1', 'CT');
    const segmentationStore = useSegmentationStore();
    const { maskId } = seatMask('img-1');
    const { segmentId } = segmentationStore.getMask(maskId);
    useSegmentStore().segments.selectSegment(segmentId);

    useDatasetStore().remove('img-1');

    expect(segmentationStore.maskExists(maskId)).toBe(false);
    // A type outlives the images it was painted on, so it stays selected.
    expect(useSegmentStore().segments.selectedSegmentId.value).toBe(segmentId);
  });

  it('leaves references to OTHER datasets intact', () => {
    seatImage('img-1', 'CT');
    seatImage('img-2', 'PET');
    const rulerStore = useRulerStore();
    const viewStore = useViewStore();
    rulerStore.addRuler(makeRuler('img-2'));
    bindFirstViewTo('img-2');

    useDatasetStore().remove('img-1');

    expect(rulerStore.serializeTools().tools).toHaveLength(1);
    expect(viewStore.getViewsForData('img-2')).toHaveLength(1);
  });
});

// Production wiring of the dev-only save backstop: each cascade-owning store
// module declares its manifest references (declareManifestRefs) next to its
// cascade. This walks the REAL declarations — loaded by the store imports
// above — over a manifest where every reference dangles, pinning that the
// backstop's coverage includes each cascade-owned section.
describe('manifest-ref declarations (cascade-owned save backstop coverage)', () => {
  it('covers every cascade-owned manifest section', async () => {
    // Side-effect imports for the declaring modules the tests above don't use.
    await import('@/src/store/tools/rectangles');
    await import('@/src/store/tools/polygons');
    const { collectManifestRefs } = await import('@/src/core/manifestRefs');

    const refs = collectManifestRefs({
      viewByID: { 'view-1': { dataID: 'ghost-img' } },
      activeView: 'ghost-view',
      layoutSlots: ['ghost-slot'],
      tools: {
        rulers: { tools: [{ imageID: 'ghost-ruler-img' }] },
        rectangles: { tools: [{ imageID: 'ghost-rect-img' }] },
        polygons: { tools: [{ imageID: 'ghost-poly-img' }] },
        crop: { 'ghost-crop-img': {} },
      },
      segmentations: [
        {
          parentImage: 'ghost-seg-img',
          masks: [
            {
              segmentId: 'ghost-segment',
              representations: {},
            },
          ],
        },
      ],
    });

    const found = refs.map((ref) => `${ref.where} -> ${ref.kind} ${ref.id}`);
    expect(found).toContain('viewByID[view-1].dataID -> dataset ghost-img');
    expect(found).toContain('activeView -> view ghost-view');
    expect(found).toContain('layoutSlots -> view ghost-slot');
    expect(found).toContain(
      'tools.rulers[0].imageID -> dataset ghost-ruler-img'
    );
    expect(found).toContain(
      'tools.rectangles[0].imageID -> dataset ghost-rect-img'
    );
    expect(found).toContain(
      'tools.polygons[0].imageID -> dataset ghost-poly-img'
    );
    expect(found).toContain(
      'tools.crop[ghost-crop-img] -> dataset ghost-crop-img'
    );
    expect(found).toContain(
      'segmentations[0].parentImage -> dataset ghost-seg-img'
    );
    expect(found).toContain(
      'segmentations[0].masks[0].segmentId -> segment ghost-segment'
    );
  });
});
