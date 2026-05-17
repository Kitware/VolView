// Validates the effective-view round-trip: the default 2x2 layout's 4th slot
// stores a 3D viewInfo. When cine binds to it, the slot renders as
// CineViewer (data wins over slot type). Dragging a volume onto that same
// slot reverts it to VolumeViewer because viewInfo was never mutated.
import { CINE_US_DATASET, PROSTATEX_DATASET } from './configTestUtils';
import { downloadFile, openUrls } from './utils';
import { volViewPage } from '../pageobjects/volview.page';

const IMAGE_DRAG_MEDIA_TYPE = 'application/x-volview-image-id';

// Dispatches a real dragstart on the source card (so the app's own handler
// stamps the imageID into the dataTransfer), then synthesizes drop on the
// target grid-item. Stays on the user-facing path (DOM only).
async function dragCardOntoGridItem(
  sourceCardSelector: string,
  targetGridItemIndex: number
): Promise<boolean> {
  return browser.execute(
    (cardSelector: string, gridItemIdx: number, mediaType: string) => {
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
    sourceCardSelector,
    targetGridItemIndex,
    IMAGE_DRAG_MEDIA_TYPE
  );
}

// Returns one of 'cine' | 'volume' | 'two' | 'empty' for a given grid-item.
async function gridItemKind(index: number) {
  return browser.execute((idx: number) => {
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

describe('Drag cine onto a non-2D slot', () => {
  it('cine renders in the 3D slot; dropping a volume reverts the slot to 3D', async () => {
    await downloadFile(PROSTATEX_DATASET.url, PROSTATEX_DATASET.name);
    await openUrls([PROSTATEX_DATASET, CINE_US_DATASET]);
    await volViewPage.waitForViews();
    await browser.waitUntil(
      async () => (await $$('.volume-card').length) >= 2,
      { timeout: 30000, timeoutMsg: 'Expected both volume cards to appear' }
    );
    // Four Up layout: axial / coronal / sagittal / volume(3D), 4 grid-items.
    await browser.waitUntil(async () => (await $$('.grid-item').length) === 4, {
      timeout: 10000,
      timeoutMsg: 'Expected the Four Up layout (4 slots)',
    });

    // Cine auto-binds to every slot on initial load, including the 3D-stored
    // slot — that's the "data wins over slot type" half of the contract.
    await browser.waitUntil(async () => (await gridItemKind(3)) === 'cine', {
      timeout: 10000,
      timeoutMsg: 'Expected the 3D slot to render as cine after load',
    });

    // Identify the volume card: the one currently NOT mounted to any view.
    // It's the non-active card in the patient browser. Stamp a unique class
    // so we can re-query stably.
    const volumeCardClass = await browser.execute(() => {
      const cards = Array.from(
        document.querySelectorAll('.volume-card')
      ) as HTMLElement[];
      const volumeCard = cards.find(
        (c) => !c.classList.contains('volume-card-active')
      );
      if (!volumeCard) return null;
      volumeCard.classList.add('e2e-volume-card');
      return 'e2e-volume-card';
    });
    expect(volumeCardClass).toBe('e2e-volume-card');

    const dropped = await dragCardOntoGridItem('.e2e-volume-card', 3);
    expect(dropped).toBe(true);

    // The slot's stored 3D viewInfo was never mutated → swap back to volume.
    await browser.waitUntil(async () => (await gridItemKind(3)) === 'volume', {
      timeout: 10000,
      timeoutMsg:
        'Expected the slot to revert to VolumeViewer after the volume drop',
    });
  });
});
