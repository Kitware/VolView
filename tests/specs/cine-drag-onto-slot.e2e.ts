// Validates the effective-view round-trip: the default 2x2 layout's 4th slot
// stores a 3D viewInfo. When cine binds to it, the slot renders as
// CineViewer (data wins over slot type). Dragging a volume onto that same
// slot reverts it to VolumeViewer because viewInfo was never mutated.
import type { Page } from '@playwright/test';
import { CINE_US_DATASET, PROSTATEX_DATASET } from '../datasets';
import { test, expect } from '../fixtures';

const IMAGE_DRAG_MEDIA_TYPE = 'application/x-volview-image-id';

// Dispatches a real dragstart on the source card (so the app's own handler
// stamps the imageID into the dataTransfer), then synthesizes drop on the
// target grid-item. Stays on the user-facing path (DOM only).
async function dragCardOntoGridItem(
  page: Page,
  sourceCardSelector: string,
  targetGridItemIndex: number
) {
  return page.evaluate(
    ({ cardSelector, gridItemIdx, mediaType }) => {
      const card = document.querySelector(cardSelector) as HTMLElement | null;
      if (!card) return false;

      const gridItems = document.querySelectorAll('.grid-item');
      const gridItem = gridItems[gridItemIdx] as HTMLElement | undefined;
      if (!gridItem) return false;

      const data = new DataTransfer();
      card.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, dataTransfer: data })
      );
      if (!data.getData(mediaType)) return false;

      gridItem.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, dataTransfer: data })
      );
      gridItem.dispatchEvent(
        new DragEvent('drop', { bubbles: true, dataTransfer: data })
      );
      return true;
    },
    {
      cardSelector: sourceCardSelector,
      gridItemIdx: targetGridItemIndex,
      mediaType: IMAGE_DRAG_MEDIA_TYPE,
    }
  );
}

// Returns one of 'cine' | 'volume' | 'two' | 'empty' for a given grid-item.
async function gridItemKind(page: Page, index: number) {
  return page.evaluate((idx: number) => {
    const item = document.querySelectorAll('.grid-item')[idx] as
      | HTMLElement
      | undefined;
    if (!item) return 'missing';
    if (item.querySelector('[data-testid~="vtk-cine-view"]')) return 'cine';
    if (item.querySelector('[data-testid~="vtk-volume-view"]')) return 'volume';
    if (item.querySelector('[data-testid~="vtk-two-view"]')) return 'two';
    return 'empty';
  }, index);
}

test.describe('Drag cine onto a non-2D slot', () => {
  test('dropping cine onto the 3D slot renders cine, and a volume restores 3D', async ({
    page,
    utils,
  }) => {
    // Four Up layout: axial / coronal / sagittal / volume(3D), 4 grid-items.
    await utils.openTwoImagesInFourUp([PROSTATEX_DATASET, CINE_US_DATASET]);

    // Fixture metadata identifies the cine independently of the active pane.
    expect(
      await dragCardOntoGridItem(
        page,
        '.volume-card[html-title="Post-Stress"]',
        3
      )
    ).toBe(true);
    await expect
      .poll(() => gridItemKind(page, 3), {
        message: 'Expected the 3D slot to render cine after the cine drop',
      })
      .toBe('cine');

    const dropped = await dragCardOntoGridItem(
      page,
      '.volume-card:not([html-title="Post-Stress"])',
      3
    );
    expect(dropped).toBe(true);

    // The slot's stored 3D viewInfo was never mutated → swap back to volume.
    await expect
      .poll(() => gridItemKind(page, 3), {
        message:
          'Expected the slot to revert to VolumeViewer after the volume drop',
      })
      .toBe('volume');
  });
});
