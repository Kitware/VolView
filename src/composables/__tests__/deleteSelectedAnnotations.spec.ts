import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { effectScope, nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { AnnotationToolType } from '@/src/store/tools/types';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useKeyboardShortcuts } from '@/src/composables/useKeyboardShortcuts';

const IMAGE_ID = 'img-1';

/** Presses delete under a live listener, then tears it down. */
const pressDelete = async () => {
  const scope = effectScope();
  scope.run(() => useKeyboardShortcuts());

  // a real keystroke starts at the focused element and bubbles to window
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Delete',
      bubbles: true,
      cancelable: true,
    })
  );
  await nextTick();

  scope.stop();
};

const addSelectedRuler = () => {
  const id = useRulerStore().addTool({
    imageID: IMAGE_ID,
    placing: false,
    firstPoint: [1, 1, 1],
    secondPoint: [2, 2, 2],
  });
  useToolSelectionStore().addSelection(id, AnnotationToolType.Ruler);
  return id;
};

describe('delete key removes selected annotations', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
      id: IMAGE_ID,
    });
    await nextTick();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('removes the selected annotation when delete is pressed', async () => {
    const ruler = addSelectedRuler();

    await pressDelete();

    expect(useRulerStore().toolByID).not.toHaveProperty(ruler);
    expect(useToolSelectionStore().selection).toEqual([]);
  });

  it('keeps unselected annotations when delete is pressed', async () => {
    const rulerStore = useRulerStore();
    const kept = rulerStore.addTool({
      imageID: IMAGE_ID,
      placing: false,
      firstPoint: [3, 3, 3],
      secondPoint: [4, 4, 4],
    });
    const selected = addSelectedRuler();

    await pressDelete();

    expect(rulerStore.toolByID).not.toHaveProperty(selected);
    expect(rulerStore.toolByID).toHaveProperty(kept);
  });

  it('ignores the delete key while typing in a text field', async () => {
    const ruler = addSelectedRuler();

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    await pressDelete();

    expect(useRulerStore().toolByID).toHaveProperty(ruler);
  });

  // Checking a row in the annotations panel leaves focus on its checkbox
  it('removes the annotation while a checkbox holds focus', async () => {
    const ruler = addSelectedRuler();

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.appendChild(checkbox);
    checkbox.focus();

    await pressDelete();

    expect(useRulerStore().toolByID).not.toHaveProperty(ruler);
  });
});
