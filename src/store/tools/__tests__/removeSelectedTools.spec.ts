import { beforeEach, describe, expect, it } from 'vitest';
import { useMessageStore } from '@/src/store/messages';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { removeSelectedTools } from '@/src/store/tools';
import { AnnotationToolType } from '@/src/store/tools/types';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { usePolygonStore } from '@/src/store/tools/polygons';

const IMAGE_ID = 'img-1';

const seatImage = () =>
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
    id: IMAGE_ID,
  });

const addRuler = () =>
  useRulerStore().addTool({
    imageID: IMAGE_ID,
    placing: false,
    firstPoint: [1, 1, 1],
    secondPoint: [2, 2, 2],
  });

const addRectangle = () =>
  useRectangleStore().addTool({ imageID: IMAGE_ID, placing: false });

const addPolygon = () =>
  usePolygonStore().addTool({ imageID: IMAGE_ID, placing: false });

describe('removeSelectedTools', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    seatImage();
    await nextTick();
  });

  it('removes selected annotations from every tool store', () => {
    const ruler = addRuler();
    const rectangle = addRectangle();
    const polygon = addPolygon();

    const selectionStore = useToolSelectionStore();
    selectionStore.addSelection(ruler, AnnotationToolType.Ruler);
    selectionStore.addSelection(rectangle, AnnotationToolType.Rectangle);
    selectionStore.addSelection(polygon, AnnotationToolType.Polygon);

    removeSelectedTools();

    expect(useRulerStore().toolByID).not.toHaveProperty(ruler);
    expect(useRectangleStore().toolByID).not.toHaveProperty(rectangle);
    expect(usePolygonStore().toolByID).not.toHaveProperty(polygon);
  });

  it('leaves unselected annotations in place', () => {
    const doomed = addRuler();
    const kept = addRuler();
    const keptRectangle = addRectangle();

    useToolSelectionStore().addSelection(doomed, AnnotationToolType.Ruler);

    removeSelectedTools();

    expect(useRulerStore().toolByID).not.toHaveProperty(doomed);
    expect(useRulerStore().toolByID).toHaveProperty(kept);
    expect(useRectangleStore().toolByID).toHaveProperty(keptRectangle);
  });

  it('empties the selection', () => {
    const ruler = addRuler();
    const selectionStore = useToolSelectionStore();
    selectionStore.addSelection(ruler, AnnotationToolType.Ruler);

    removeSelectedTools();

    expect(selectionStore.selection).toEqual([]);
    expect(selectionStore.isSelected(ruler)).toBe(false);
  });

  it('does nothing when nothing is selected', () => {
    const ruler = addRuler();

    removeSelectedTools();

    expect(useRulerStore().toolByID).toHaveProperty(ruler);
  });

  // the selection can hold annotations with no visible cue in the current view
  // (hidden, other slices, other axes) and there is no undo
  it('reports how many annotations were deleted', () => {
    const selectionStore = useToolSelectionStore();
    selectionStore.addSelection(addRuler(), AnnotationToolType.Ruler);
    selectionStore.addSelection(addRectangle(), AnnotationToolType.Rectangle);

    removeSelectedTools();

    const messages = useMessageStore().messages;
    expect(messages.at(-1)?.title).toBe('Deleted 2 annotations');
  });

  it('uses the singular for a single deleted annotation', () => {
    useToolSelectionStore().addSelection(addRuler(), AnnotationToolType.Ruler);

    removeSelectedTools();

    expect(useMessageStore().messages.at(-1)?.title).toBe(
      'Deleted 1 annotation'
    );
  });

  it('says nothing when nothing was deleted', () => {
    removeSelectedTools();

    expect(useMessageStore().messages).toHaveLength(0);
  });
});
