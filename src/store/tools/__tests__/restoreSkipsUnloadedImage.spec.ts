import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRulerStore } from '@/src/store/tools/rulers';

// ---------------------------------------------------------------------------
// Regression: a state file whose dataset could not be loaded leaves its id out
// of the restore dataIDMap. Annotations of that image used to be seated with
// imageID undefined, which no view can draw and which makes the next save's
// whole tools section fail validation — taking the annotations of the images
// that did load down with it.
// ---------------------------------------------------------------------------

const LOADED = 'img-loaded';
const MISSING = 'img-missing';

const seat = (id: string) =>
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
    id,
  });

/** Rulers on two images, serialized the way a save writes them. */
const savedRulers = () => {
  seat(LOADED);
  seat(MISSING);
  const store = useRulerStore();
  store.addTool({
    imageID: LOADED,
    placing: false,
    firstPoint: [1, 1, 1],
    secondPoint: [2, 2, 2],
  });
  store.addTool({ imageID: MISSING, placing: false });
  return JSON.parse(JSON.stringify(store.serializeTools()));
};

describe('restoring annotations whose image did not load', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('skips the annotations of the image that is missing', () => {
    const serialized = savedRulers();
    expect(serialized.tools).toHaveLength(2);

    setActivePinia(createPinia());
    seat(LOADED);
    const restored = useRulerStore();
    restored.deserializeTools(serialized, { [LOADED]: LOADED });

    const tools = restored.toolIDs.map((id) => restored.toolByID[id]);
    expect(tools.map((tool) => tool.imageID)).toEqual([LOADED]);
    expect(tools[0].firstPoint).toEqual([1, 1, 1]);
    expect(tools[0].secondPoint).toEqual([2, 2, 2]);
  });

  it('keeps the surviving annotations saveable', () => {
    const serialized = savedRulers();

    setActivePinia(createPinia());
    seat(LOADED);
    const restored = useRulerStore();
    restored.deserializeTools(serialized, { [LOADED]: LOADED });
    const resaved = restored.serializeTools();

    expect(resaved.tools).toHaveLength(1);
    expect(resaved.tools[0].imageID).toBe(LOADED);
    expect(
      ManifestSchema.shape.tools.safeParse({ rulers: resaved }).success
    ).toBe(true);
  });

  it('follows the image an annotation was remapped onto', () => {
    const serialized = savedRulers();

    setActivePinia(createPinia());
    seat('new-id');
    const restored = useRulerStore();
    restored.deserializeTools(serialized, { [LOADED]: 'new-id' });

    expect(restored.toolIDs.map((id) => restored.toolByID[id].imageID)).toEqual(
      ['new-id']
    );
  });

  it('restores nothing when no image came back', () => {
    const serialized = JSON.parse(
      JSON.stringify(
        (() => {
          seat(MISSING);
          const store = usePolygonStore();
          store.addTool({ imageID: MISSING, placing: false });
          return store.serializeTools();
        })()
      )
    );

    setActivePinia(createPinia());
    const restored = usePolygonStore();
    restored.deserializeTools(serialized, {});

    expect(restored.toolIDs).toEqual([]);
  });
});
