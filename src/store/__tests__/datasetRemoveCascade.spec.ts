import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useDatasetStore } from '@/src/store/datasets';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useSegmentationStore } from '@/src/store/segmentations';
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

describe('dataset remove — synchronous reference cascade', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('clears segment groups whose parent image was removed', () => {
    seatImage('img-1', 'CT');
    const segmentGroups = useSegmentGroupStore();
    const segmentations = useSegmentationStore();
    const groupId = segmentGroups.newLabelmapFromImage('img-1');
    expect(groupId).not.toBeNull();
    expect(segmentations.artifactOrderByParent['img-1']).toContain(groupId);

    useDatasetStore().remove('img-1');

    expect(segmentations.artifactOrderByParent['img-1'] ?? []).toEqual([]);
    expect(segmentations.artifactMeta).not.toHaveProperty(groupId as string);
  });

  it('clears ALL segment groups when an image has several (no splice-skip)', () => {
    seatImage('img-1', 'CT');
    const segmentGroups = useSegmentGroupStore();
    const segmentations = useSegmentationStore();
    const groupA = segmentGroups.newLabelmapFromImage('img-1');
    const groupB = segmentGroups.newLabelmapFromImage('img-1');
    const groupC = segmentGroups.newLabelmapFromImage('img-1');
    expect(groupA).not.toBeNull();
    expect(groupB).not.toBeNull();
    expect(groupC).not.toBeNull();
    expect(segmentations.artifactOrderByParent['img-1']).toEqual([
      groupA,
      groupB,
      groupC,
    ]);

    useDatasetStore().remove('img-1');

    expect(segmentations.artifactOrderByParent['img-1'] ?? []).toEqual([]);
    [groupA, groupB, groupC].forEach((id) => {
      expect(segmentations.artifactMeta).not.toHaveProperty(id as string);
      expect(segmentations.artifactIndex).not.toHaveProperty(id as string);
    });
  });

  it('removes the segmentation and its artifacts with the parent image', () => {
    seatImage('img-1', 'CT');
    const segmentGroups = useSegmentGroupStore();
    const segmentations = useSegmentationStore();
    const artifactId = segmentGroups.newLabelmapFromImage('img-1') as string;
    const segmentation = segmentations.getSegmentationForImage('img-1');
    expect(segmentation).toBeTruthy();
    expect(segmentations.artifactMeta).toHaveProperty(artifactId);

    useDatasetStore().remove('img-1');

    expect(segmentations.getSegmentationForImage('img-1')).toBeFalsy();
    expect(segmentations.segmentations).not.toHaveProperty(segmentation!.id);
    expect(segmentations.artifactMeta).not.toHaveProperty(artifactId);
    expect(segmentations.artifactIndex).not.toHaveProperty(artifactId);
  });

  it('leaves another image segmentation intact', () => {
    seatImage('img-1', 'CT');
    seatImage('img-2', 'PET');
    const segmentGroups = useSegmentGroupStore();
    const segmentations = useSegmentationStore();
    segmentGroups.newLabelmapFromImage('img-1');
    const keptArtifact = segmentGroups.newLabelmapFromImage('img-2') as string;

    useDatasetStore().remove('img-1');

    expect(segmentations.getSegmentationForImage('img-2')).toBeTruthy();
    expect(segmentations.artifactMeta).toHaveProperty(keptArtifact);
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

  it('clears the active segment when its parent image is removed', () => {
    seatImage('img-1', 'CT');
    const segmentGroups = useSegmentGroupStore();
    const segmentationStore = useSegmentationStore();
    const groupId = segmentGroups.newLabelmapFromImage('img-1')!;
    const segmentation = segmentationStore.getSegmentationForArtifact(groupId)!;
    const [segment] = segmentationStore.segmentsForArtifact(groupId);
    segmentationStore.setActiveSegment(segmentation.id, segment.id);
    expect(segmentationStore.activeArtifactId).toBe(groupId);

    useDatasetStore().remove('img-1');

    expect(segmentationStore.activeTarget).toBeUndefined();
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
          segments: [
            {
              representations: {
                labelmap: { artifactId: 'ghost-artifact' },
              },
            },
          ],
        },
      ],
      segmentationArtifacts: [{ parentImage: 'ghost-artifact-img' }],
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
      'segmentations[0].segments[0].representations.labelmap.artifactId -> segmentationArtifact ghost-artifact'
    );
    expect(found).toContain(
      'segmentationArtifacts[0].parentImage -> dataset ghost-artifact-img'
    );
  });
});
