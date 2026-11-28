import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { MRA_HEAD_NECK_DATASET, PROSTATEX_DATASET } from '../datasets';

const IMAGE_DRAG_MEDIA_TYPE = 'application/x-volview-image-id';

// Four Up: the loaded image fills every slot, so these two get the other one.
const FIRST_OTHER_SLOT = 2;
const SECOND_OTHER_SLOT = 1;

/**
 * Dispatches a real dragstart on a volume card so the app stamps the imageID
 * into the dataTransfer, then synthesizes the drop on a layout slot.
 */
const dropCardOnSlot = (page: Page, cardIndex: number, slotIndex: number) =>
  page.evaluate(
    ({ card_, index, mediaType }) => {
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
    { card_: cardIndex, index: slotIndex, mediaType: IMAGE_DRAG_MEDIA_TYPE }
  );

/** The slice each layout slot reports, or null where a slot shows none. */
const getSlices = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('.grid-item')).map((slot) => {
      const match = slot.textContent?.match(/Slice:\s*(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    })
  );

const slotCenter = async (page: Page, index: number) => {
  const box = await page
    .locator('.grid-item')
    .nth(index)
    .locator('canvas')
    .boundingBox();
  if (!box) throw new Error(`Layout slot ${index} has no canvas on screen`);
  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
};

const dragInSlot = async (
  page: Page,
  index: number,
  dx: number,
  dy: number
) => {
  const { x, y } = await slotCenter(page, index);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy);
  await page.mouse.up();
};

test.describe('Crosshairs with two base images', () => {
  test('only slices the views showing the image it was dragged in', async ({
    page,
    utils,
  }) => {
    await utils.openTwoImagesInFourUp([
      PROSTATEX_DATASET,
      MRA_HEAD_NECK_DATASET,
    ]);

    // The loaded image fills every slot; the other one is the card that is not
    // marked active, and is what these drops mount.
    const otherCard = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.volume-card')).findIndex(
        (candidate) => !candidate.classList.contains('volume-card-active')
      )
    );
    expect(otherCard).toBeGreaterThanOrEqual(0);

    expect(await dropCardOnSlot(page, otherCard, FIRST_OTHER_SLOT)).toBe(true);
    await expect
      .poll(async () => (await getSlices(page))[FIRST_OTHER_SLOT] != null, {
        message: 'Expected the dropped image to render',
      })
      .toBe(true);

    const crosshairsButton = page.locator(
      'button span i[class~=mdi-crosshairs]'
    );
    await crosshairsButton.click();

    const before = await getSlices(page);

    // Drag the crosshair well off centre in a view of the other image.
    await dragInSlot(page, 0, 60, 40);

    await expect
      .poll(async () => (await getSlices(page))[1], {
        message:
          'Expected the crosshair drag to re-slice the peer view of the same image',
      })
      .not.toBe(before[1]);

    const afterDrag = await getSlices(page);
    expect(afterDrag[FIRST_OTHER_SLOT]).toBe(before[FIRST_OTHER_SLOT]);

    // Mounting that image into a second slot makes it the active image. That is
    // not a crosshair interaction, so the slot already showing it must not be
    // re-sliced to wherever the crosshair sits in the other image.
    expect(await dropCardOnSlot(page, otherCard, SECOND_OTHER_SLOT)).toBe(true);
    await expect
      .poll(async () => (await getSlices(page))[SECOND_OTHER_SLOT], {
        message: 'Expected the second slot to remount',
      })
      .not.toBe(afterDrag[1]);

    const afterRemount = await getSlices(page);
    expect(afterRemount[FIRST_OTHER_SLOT]).toBe(before[FIRST_OTHER_SLOT]);
    expect(afterRemount[0]).toBe(afterDrag[0]);
  });
});
