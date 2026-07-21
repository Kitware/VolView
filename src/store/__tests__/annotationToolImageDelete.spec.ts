import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { effectScope, nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useRulerStore } from '@/src/store/tools/rulers';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import type { Ruler } from '@/src/types/ruler';
import type { RequiredWithPartial } from '@/src/types';

// ---------------------------------------------------------------------------
// Delete-base-then-save, tool half: removing an
// annotated dataset must remove its annotation tools too — an orphaned
// imageID serialized into the save manifest is exactly the backend's
// intentionally fail-closed 400 ('tool has unresolvable imageID'), turning a
// routine delete gesture into a permanently unsavable session.
//
// The mechanism is the same onImageDeleted subscription segmentGroups already
// uses for its labelmap cascade — so this spec also pins the composable
// itself: it must actually FIRE on image-cache deletion (a watch on the ref
// of the reactive index never triggers on a key delete; the composable
// watches the key SET).
// ---------------------------------------------------------------------------

const seatImage = (id: string, name: string) =>
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), name, {
    id,
  });

const makeRuler = (
  imageID: string
): RequiredWithPartial<
  Ruler,
  | 'id'
  | 'color'
  | 'strokeWidth'
  | 'label'
  | 'labelName'
  | 'hidden'
  | 'metadata'
  | 'frame'
> => ({
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
});

describe('onImageDeleted — fires on image-cache deletion', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('reports exactly the deleted image ids', async () => {
    seatImage('img-1', 'CT');
    seatImage('img-2', 'PET');

    const seen: string[][] = [];
    onImageDeleted((ids) => seen.push([...ids]));

    useImageCacheStore().removeImage('img-1');
    await nextTick();

    expect(seen).toEqual([['img-1']]);
  });

  it('stays quiet on additions', async () => {
    const seen: string[][] = [];
    onImageDeleted((ids) => seen.push([...ids]));

    seatImage('img-1', 'CT');
    await nextTick();

    expect(seen).toEqual([]);
  });

  it('keeps later subscribers alive when the first scope is disposed', () => {
    seatImage('img-1', 'CT');
    const first = effectScope();
    const second = effectScope();
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();

    first.run(() => onImageDeleted(firstCallback));
    second.run(() => onImageDeleted(secondCallback));
    first.stop();

    useImageCacheStore().removeImage('img-1');

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledWith(['img-1']);
    second.stop();
  });
});

describe('annotation tools — delete-base cleanup', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('removes exactly the deleted image’s tools; other images’ tools survive', async () => {
    seatImage('img-1', 'CT');
    seatImage('img-2', 'PET');

    const rulerStore = useRulerStore();
    const doomed = rulerStore.addRuler(makeRuler('img-1'));
    const kept = rulerStore.addRuler(makeRuler('img-2'));

    useImageCacheStore().removeImage('img-1');
    await nextTick();

    expect(rulerStore.rulerByID).not.toHaveProperty(doomed);
    expect(rulerStore.rulerByID).toHaveProperty(kept);
  });

  it('a subsequent serialize carries NO tool referencing the deleted image', async () => {
    seatImage('img-1', 'CT');

    const rulerStore = useRulerStore();
    rulerStore.addRuler(makeRuler('img-1'));

    useImageCacheStore().removeImage('img-1');
    await nextTick();

    const { tools } = rulerStore.serializeTools();
    expect(tools).toEqual([]);
  });

  it('cleans up every annotation tool store, not just rulers', async () => {
    seatImage('img-1', 'CT');

    const polygonStore = usePolygonStore();
    const rectangleStore = useRectangleStore();
    polygonStore.addTool({ imageID: 'img-1', placing: false });
    rectangleStore.addTool({ imageID: 'img-1', placing: false });

    useImageCacheStore().removeImage('img-1');
    await nextTick();

    expect(polygonStore.serializeTools().tools).toEqual([]);
    expect(rectangleStore.serializeTools().tools).toEqual([]);
  });
});
