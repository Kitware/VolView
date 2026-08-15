import { MRA_HEAD_NECK_DATASET, PROSTATEX_DATASET } from './configTestUtils';
import { openUrls } from './utils';
import { volViewPage } from '../pageobjects/volview.page';

const IMAGE_DRAG_MEDIA_TYPE = 'application/x-volview-image-id';

// Four Up: the loaded image fills every slot, so these two get the other one.
const FIRST_OTHER_SLOT = 2;
const SECOND_OTHER_SLOT = 1;

/**
 * Dispatches a real dragstart on a volume card so the app stamps the imageID
 * into the dataTransfer, then synthesizes the drop on a layout slot.
 */
const dropCardOnSlot = (cardIndex: number, slotIndex: number) =>
  browser.execute(
    (card_: number, index: number, mediaType: string) => {
      const card = document.querySelectorAll('.volume-card')[card_] as
        | HTMLElement
        | undefined;
      const slot = document.querySelectorAll('.grid-item')[index] as
        | HTMLElement
        | undefined;
      if (!card || !slot) return false;

      const data = new DataTransfer();
      card.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, dataTransfer: data })
      );
      if (!data.getData(mediaType)) return false;

      slot.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, dataTransfer: data })
      );
      slot.dispatchEvent(
        new DragEvent('drop', { bubbles: true, dataTransfer: data })
      );
      return true;
    },
    cardIndex,
    slotIndex,
    IMAGE_DRAG_MEDIA_TYPE
  );

/** The slice each layout slot reports, or null where a slot shows none. */
const getSlices = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('.grid-item')).map((slot) => {
      const match = slot.textContent?.match(/Slice:\s*(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    })
  );

const slotCenter = async (index: number) => {
  const canvas = await $$('.grid-item')[index].$('canvas');
  const { x, y } = await canvas.getLocation();
  const { width, height } = await canvas.getSize();
  return {
    x: Math.round(x + width / 2),
    y: Math.round(y + height / 2),
  };
};

const dragInSlot = async (index: number, dx: number, dy: number) => {
  const { x, y } = await slotCenter(index);
  await browser
    .action('pointer')
    .move({ x, y })
    .down()
    .move({ x: x + dx, y: y + dy })
    .up()
    .perform();
};

describe('Crosshairs with two base images', () => {
  it('only slices the views showing the image it was dragged in', async () => {
    await openUrls([PROSTATEX_DATASET, MRA_HEAD_NECK_DATASET]);
    await volViewPage.waitForViews();
    await browser.waitUntil(
      async () => (await $$('.volume-card').length) >= 2,
      {
        timeout: 30000,
        timeoutMsg: 'Expected both volume cards to appear',
      }
    );
    await browser.waitUntil(async () => (await $$('.grid-item').length) === 4, {
      timeout: 10000,
      timeoutMsg: 'Expected the Four Up layout (4 slots)',
    });

    // The loaded image fills every slot; the other one is the card that is not
    // marked active, and is what these drops mount.
    const otherCard = await browser.execute(() =>
      Array.from(document.querySelectorAll('.volume-card')).findIndex(
        (candidate) => !candidate.classList.contains('volume-card-active')
      )
    );
    expect(otherCard).toBeGreaterThanOrEqual(0);

    expect(await dropCardOnSlot(otherCard, FIRST_OTHER_SLOT)).toBe(true);
    await browser.waitUntil(
      async () => (await getSlices())[FIRST_OTHER_SLOT] != null,
      { timeout: 15000, timeoutMsg: 'Expected the dropped image to render' }
    );

    const crosshairsButton = await $('button span i[class~=mdi-crosshairs]');
    await crosshairsButton.waitForClickable();
    await crosshairsButton.click();

    const before = await getSlices();

    // Drag the crosshair well off centre in a view of the other image.
    await dragInSlot(0, 60, 40);

    await browser.waitUntil(async () => (await getSlices())[1] !== before[1], {
      timeoutMsg:
        'Expected the crosshair drag to re-slice the peer view of the same image',
    });

    const afterDrag = await getSlices();
    expect(afterDrag[FIRST_OTHER_SLOT]).toBe(before[FIRST_OTHER_SLOT]);

    // Mounting that image into a second slot makes it the active image. That is
    // not a crosshair interaction, so the slot already showing it must not be
    // re-sliced to wherever the crosshair sits in the other image.
    expect(await dropCardOnSlot(otherCard, SECOND_OTHER_SLOT)).toBe(true);
    await browser.waitUntil(
      async () => (await getSlices())[SECOND_OTHER_SLOT] !== afterDrag[1],
      { timeout: 15000, timeoutMsg: 'Expected the second slot to remount' }
    );

    const afterRemount = await getSlices();
    expect(afterRemount[FIRST_OTHER_SLOT]).toBe(before[FIRST_OTHER_SLOT]);
    expect(afterRemount[0]).toBe(afterDrag[0]);
  });
});
