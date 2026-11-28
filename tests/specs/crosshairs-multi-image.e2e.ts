import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import type { Utils } from './utils';

const IMAGE_DRAG_MEDIA_TYPE = 'application/x-volview-image-id';

// Four Up: the loaded image fills every slot, so these two get the other one.
const FIRST_OTHER_SLOT = 2;
const SECOND_OTHER_SLOT = 1;

const openImages = async (page: Page, volview: VolViewPage, utils: Utils) => {
  const directory = utils.makeTempDir('crosshairs-images');
  const studyUid = newUid();
  // Separate image bounds make an incorrectly shared crosshair clamp the other
  // volume to an edge slice instead of leaving it at the middle slice.
  const resources = [0, 100].flatMap((origin, series) => {
    const seriesUid = newUid();
    return Array.from({ length: 16 }, (_, slice) => {
      const filename = `${series}-${slice}.dcm`;
      writeFileSync(
        join(directory, filename),
        buildSyntheticDicom({
          studyUid,
          seriesUid,
          sopUid: newUid(),
          instanceNumber: slice + 1,
          seriesNumber: series + 1,
          imageOrientationPatient: [1, 0, 0, 0, 1, 0],
          imagePositionPatient: [origin, origin, origin + slice],
          rows: 16,
          cols: 16,
          pixelValue: 20 + slice * 10,
        })
      );
      return { url: `/tmp/crosshairs-images/${filename}` };
    });
  });
  await utils.writeManifestToFile({ resources }, 'crosshairs-images.json');
  await volview.open('?urls=[tmp/crosshairs-images.json]');
  await volview.waitForViews();
  await volview.waitForVolumeCardSliceCounts([16, 16]);
  await expect(
    page.locator('.grid-item'),
    'Expected the Four Up layout (4 slots)'
  ).toHaveCount(4);
};

const slotImage = (page: Page, index: number) =>
  page
    .locator('.grid-item')
    .nth(index)
    .locator('.view-annotations .annotation-cell')
    .first();

const slotSliceLabel = (page: Page, index: number) =>
  page.locator('.grid-item').nth(index).locator('.slice-label').first();

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
    volview,
    utils,
  }) => {
    await openImages(page, volview, utils);

    // The loaded image fills every slot; the other one is the card that is not
    // marked active, and is what these drops mount.
    const otherCard = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.volume-card')).findIndex(
        (candidate) => !candidate.classList.contains('volume-card-active')
      )
    );
    expect(otherCard).toBeGreaterThanOrEqual(0);
    const otherName = await page
      .locator('.volume-card')
      .nth(otherCard)
      .locator('.series-desc')
      .innerText();
    const activeName = await slotImage(page, 0).innerText();
    expect(activeName).not.toBe('');
    expect(otherName).not.toBe(activeName);
    await expect(slotImage(page, SECOND_OTHER_SLOT)).toHaveText(activeName);

    expect(await dropCardOnSlot(page, otherCard, FIRST_OTHER_SLOT)).toBe(true);
    await expect(slotImage(page, FIRST_OTHER_SLOT)).toHaveText(otherName);

    const crosshairsButton = page.locator(
      'button span i[class~=mdi-crosshairs]'
    );
    await crosshairsButton.click();

    for (const slot of [0, 1, 2])
      await expect(slotSliceLabel(page, slot)).toHaveText('Slice: 9/16');
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
    await expect(slotImage(page, SECOND_OTHER_SLOT)).toHaveText(otherName);
    await expect(slotSliceLabel(page, SECOND_OTHER_SLOT)).toHaveText(
      'Slice: 9/16'
    );

    const afterRemount = await getSlices(page);
    expect(afterRemount[FIRST_OTHER_SLOT]).toBe(before[FIRST_OTHER_SLOT]);
    expect(afterRemount[0]).toBe(afterDrag[0]);
  });
});
