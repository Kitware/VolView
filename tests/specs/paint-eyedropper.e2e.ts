import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { ONE_CT_SLICE_DICOM } from '../datasets';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { Utils } from './utils';
import type { SegmentationUtils } from './segmentationTestUtils';

const row = (page: Page, name: string) =>
  page.locator(`[data-testid="segment-list"] .item-row[aria-label="${name}"]`);
const selected = (page: Page) =>
  page.locator('[data-testid="segment-list"] .item-row[aria-current="true"]');
const eyedropper = (page: Page) =>
  page.locator('[data-testid="paint-eyedropper-button"]');
const click = async (page: Page, x: number, y: number) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
};

const expectBackgroundUnpainted = async (page: Page, x: number, y: number) => {
  await row(page, 'Segment 3').click();
  await eyedropper(page).click();
  await click(page, x, y);
  await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 3');
};

const openPaintedScene = async ({
  page,
  volview,
  utils,
  segmentation,
}: {
  page: Page;
  volview: VolViewPage;
  utils: Utils;
  segmentation: SegmentationUtils;
}) => {
  await utils.openUrls([ONE_CT_SLICE_DICOM]);
  await volview.activatePaint();
  await segmentation.openAnnotationSegments();
  const view = volview.views2D.first();
  const canvas = view.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The view has no canvas on screen');
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await click(page, x, y);
  await expect(
    row(page, 'Segment 1').locator('[data-testid="reveal-segment-button"]')
  ).toBeEnabled();
  return { view, canvas, x, y };
};

test.describe('Paint eyedropper', () => {
  for (const [tool, icon] of [
    ['ruler', 'mdi-ruler'],
    ['rectangle', 'mdi-vector-square'],
  ]) {
    test(`samples painted content after switching from a picked ${tool} handle`, async ({
      page,
      volview,
      utils,
      annotation,
      segmentation,
    }) => {
      const { view, canvas, x, y } = await openPaintedScene({
        page,
        volview,
        utils,
        segmentation,
      });
      await segmentation.addSegment();
      await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 2');
      await expect(
        row(page, 'Segment 2').locator('[data-testid="reveal-segment-button"]')
      ).toBeDisabled();

      await volview.selectTool(icon);
      await annotation.nudgeTo(x + 60, y - 60);
      await annotation.pressAtPointer();
      await annotation.nudgeTo(x + 90, y - 30);
      await annotation.pressAtPointer();
      await volview.selectTool('mdi-cursor-default');
      await expect(view.locator('svg circle')).toHaveCount(2);
      await annotation.nudgeTo(x - 50, y + 50);
      await expect(canvas).toHaveCSS('cursor', 'default');
      await annotation.nudgeTo(x + 60, y - 60);
      await expect(canvas).toHaveCSS('cursor', 'pointer');

      await volview.activatePaint();
      await eyedropper(page).click();
      await expect(eyedropper(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(canvas).toHaveCSS('cursor', /^url\(/);
      await annotation.nudgeTo(x, y);
      await annotation.pressAtPointer();
      await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 1');

      // Removing the painted segment leaves only the annotation, with no mask to save.
      await segmentation.deleteSegment('Segment 1');
      await expect(row(page, 'Segment 2')).toBeAttached();
      await expect(volview.saveSegmentsButtons.first()).toBeDisabled();
    });
  }

  test('picks visible label maps without painting and restores the held mode', async ({
    page,
    volview,
    utils,
    segmentation,
  }) => {
    const { canvas, x, y } = await openPaintedScene({
      page,
      volview,
      utils,
      segmentation,
    });
    const { mouse, keyboard } = page;
    await segmentation.allowOverlap();
    await page.locator('[data-testid="segment-list"] .create-row').click();
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 2');
    await click(page, x, y);
    await page.locator('[data-testid="segment-list"] .create-row').click();
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 3');

    const list = page.locator('[data-testid="segment-list"] .item-list-scroll');
    await list.evaluate((element) => {
      element.style.maxHeight = '64px';
      element.scrollTop = element.scrollHeight;
    });
    const selectedRowInView = () =>
      list.evaluate((element) => {
        const selectedRow = element.querySelector('[aria-current="true"]')!;
        const bounds = element.getBoundingClientRect();
        const item = selectedRow.getBoundingClientRect();
        return item.top >= bounds.top && item.bottom <= bounds.bottom;
      });

    await eyedropper(page).click();
    await expect(eyedropper(page)).toHaveAttribute('aria-pressed', 'true');
    await click(page, x, y);
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 1');
    await expect.poll(selectedRowInView).toBe(true);
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await selectedRowInView()).toBe(false);
    await click(page, x, y);
    await expect.poll(selectedRowInView).toBe(true);
    await row(page, 'Segment 1').locator('.reorder-handle').click();
    await keyboard.press('Alt+ArrowDown');
    await expect(row(page, 'Segment 2').locator('kbd')).toHaveText('1');
    await click(page, x, y);
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 2');
    await expect.poll(selectedRowInView).toBe(true);
    await row(page, 'Segment 2')
      .locator('button[aria-label="Hide Segment 2"]')
      .click();
    await click(page, x, y);
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 1');
    await click(page, x + 70, y);
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 1');

    await row(page, 'Segment 2')
      .locator('button[aria-label="Show Segment 2"]')
      .click();
    await keyboard.press('e');
    await row(page, 'Segment 3').click();
    await keyboard.down('d');
    await expect(eyedropper(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas).toHaveCSS('cursor', /^url\(/);
    await mouse.move(x, y);
    await mouse.down();
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 2');
    await keyboard.up('d');
    await expect(eyedropper(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('button.mode-button.selected')).toHaveText(
      'Erase'
    );
    await mouse.move(x + 70, y);
    await mouse.up();

    // Sampling leaves background untouched and the painted segment pickable.
    await expectBackgroundUnpainted(page, x + 70, y);
    await click(page, x, y);
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 2');

    await keyboard.press('p');
    await mouse.move(x, y);
    await mouse.down();
    await keyboard.down('d');
    await expect(eyedropper(page)).toHaveAttribute('aria-pressed', 'true');
    await mouse.move(x + 70, y);
    await keyboard.up('d');
    await mouse.move(x + 80, y);
    await mouse.up();
    await expectBackgroundUnpainted(page, x + 70, y);
    await click(page, x + 80, y);
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 3');

    await keyboard.press('p');
    await row(page, 'Segment 3')
      .locator('[data-testid="edit-segment-button"]')
      .click();
    const input = page.locator('div[role="dialog"] .v-text-field input');
    await input.click();
    await keyboard.down('d');
    await expect(input).toHaveValue('Segment 3d');
    await expect(eyedropper(page)).toHaveAttribute('aria-pressed', 'false');
    await keyboard.up('d');
  });
});
