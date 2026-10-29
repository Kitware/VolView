import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import JSZip from 'jszip';
import type { Vector3 } from '@kitware/vtk.js/types';

import {
  manifestForImages,
  makeLabelmap,
  markedVoxels,
  seatImage,
  seedVoxel,
  showImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { AnnotationToolType } from '@/src/store/tools/types';

const detached = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const ruler = (imageID: string, segmentId: string, placing = false) => ({
  imageID,
  segmentId,
  placing,
  slice: 0,
  frameOfReference: {
    planeOrigin: [0, 0, 0] as Vector3,
    planeNormal: [0, 0, 1] as Vector3,
  },
  firstPoint: [0, 0, 0] as Vector3,
  secondPoint: [1, 1, 0] as Vector3,
});

const copiedCatalog = async (count: number) => {
  const segmentStore = useSegmentStore();
  const rulers = useRulerStore();
  await seatImage('b');
  await seatImage('a');
  await showImage('b');
  segmentStore.replaceConfigSegments(
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `Label ${index}`,
        { color: '#336699' },
      ])
    )
  );
  segmentStore.segments.segmentList('b').forEach(({ id }) => {
    rulers.addRuler(ruler('b', id));
  });
  await showImage('a');
  return { segmentStore, registry: segmentStore.segments, rulers };
};

const serializeNow = (imageIds: string[]) => {
  const state = {
    zip: new JSZip(),
    manifest: manifestForImages(imageIds, { tools: {} }),
  };
  useSegmentStore().serialize(state);
  useRulerStore().serialize(state);
  return state.manifest;
};

describe('bulk image segment removal', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('removes a copied empty catalog and preserves the remaining definitions and complete ruler geometry', async () => {
    const { registry, rulers } = await copiedCatalog(32);
    const masks = useSegmentationStore();
    const beforeSegments = detached(registry.segmentList('b'));
    const beforeRulers = detached(rulers.serializeTools());
    const removedIds = registry.segmentList('a').map(({ id }) => id);
    expect(
      new Set([...removedIds, ...beforeSegments.map(({ id }) => id)]).size
    ).toBe(64);
    expect(masks.segmentations).toEqual({});
    const cancelPreview = vi.fn();
    useSegmentationEditsStore().hold(cancelPreview);

    useImageCacheStore().removeImage('a');

    const saved = serializeNow(['b']);
    expect(saved.segments).toEqual(beforeSegments);
    expect(saved.tools?.rulers).toEqual(beforeRulers);
    expect(saved.imageSegmentSets?.map(({ imageId }) => imageId)).toEqual([
      'b',
    ]);
    expect(
      removedIds.every(
        (id) => !registry.getSegment(id) && !registry.ownerImageId(id)
      )
    ).toBe(true);
    expect(masks.segmentations).toEqual({});
    expect(cancelPreview).not.toHaveBeenCalled();
  });

  it('removes finished content synchronously while keeping a placing stub and cached-image settings until image eviction', async () => {
    const { registry, rulers } = await copiedCatalog(2);
    const masks = useSegmentationStore();
    const aSegments = registry.segmentList('a');
    const b = registry.segmentList('b')[0].id;
    const finishedA = aSegments.map(({ id }) =>
      rulers.addRuler(ruler('a', id))
    );
    const stubA = rulers.addRuler(ruler('a', aSegments[0].id, true));
    const aMasks = aSegments.map(({ id }) => masks.resolveEditTarget('a', id));
    aMasks.forEach((id, index) => seedVoxel(id, [index, 0, 0]));
    const bMask = masks.resolveEditTarget('b', b);
    seedVoxel(bMask, [1, 1, 0]);
    const originalB = detached(
      rulers.serializeTools().tools.filter(({ imageID }) => imageID === 'b')
    );
    const segmentationA = masks.getSegmentationForImage('a')!;
    masks.updateSegmentationDisplay(segmentationA.id, {
      fillOpacity: 0.8,
      outlineThickness: 4,
    });
    const selection = useToolSelectionStore();
    selection.addSelection(finishedA[0], AnnotationToolType.Ruler);
    selection.addSelection(rulers.rulerIDs[0], AnnotationToolType.Ruler);

    registry.removeImage('a');

    const saved = serializeNow(['a', 'b']);
    expect(saved.tools?.rulers?.tools).toEqual(originalB);
    expect(saved.segments).toEqual(registry.segmentList('b'));
    expect(finishedA.every((id) => !rulers.toolByID[id])).toBe(true);
    expect(rulers.toolByID[stubA]?.placing).toBe(true);
    expect(selection.isSelected(finishedA[0])).toBe(false);
    expect(selection.isSelected(rulers.rulerIDs[0])).toBe(true);
    expect(aMasks.every((id) => !masks.maskExists(id))).toBe(true);
    expect(masks.getSegmentationForImage('a')).toBe(segmentationA);
    expect(segmentationA).toMatchObject({
      fillOpacity: 0.8,
      outlineThickness: 4,
      order: [],
      masks: {},
    });
    expect(markedVoxels(bMask)).toEqual([[1, 1, 0, 1]]);

    useImageCacheStore().removeImage('a');
    expect(rulers.toolByID[stubA]).toBeUndefined();
    expect(masks.getSegmentationForImage('a')).toBeUndefined();
    expect(rulers.serializeTools().tools).toEqual(originalB);
    expect(markedVoxels(bMask)).toEqual([[1, 1, 0, 1]]);
  });

  it('releases every removed mask name without reserving it against another image', async () => {
    await seatImage('a', { name: 'CT' });
    await seatImage('b', { name: 'CT' });
    const store = useSegmentationStore();
    const registry = useSegmentStore().segments;
    const values = new Uint8Array(64);
    values[0] = 1;
    values[1] = 2;
    store.splitLabelmapIntoMasks(
      'a',
      makeLabelmap({ values }),
      [
        { value: 1, name: 'Tumor', color: [255, 0, 0, 255], visible: true },
        { value: 2, name: 'Node', color: [0, 255, 0, 255], visible: true },
      ],
      { name: 'Segment Group 2 for CT' }
    );

    registry.removeImage('a');

    const names = ['First', 'Second'].map((name) => {
      const segmentId = registry.addSegment('b', { name });
      const maskId = store.resolveEditTarget('b', segmentId);
      return store.ensureLabelmapBinding(maskId).name;
    });
    expect(names).toEqual(['Segment Group 1 for CT', 'Segment Group 2 for CT']);
  });
});
