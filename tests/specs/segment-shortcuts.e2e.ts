import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { ONE_CT_SLICE_DICOM } from '../datasets';

const selected = (page: Page) =>
  page.locator('[data-testid="segment-list"] .item-row[aria-current="true"]');
const segmentRow = (page: Page, name: string) =>
  page.locator(`[data-testid="segment-list"] .item-row[aria-label="${name}"]`);
const titles = (page: Page) =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-testid="segment-list"] .item-row'),
      (row) => row.getAttribute('aria-label')
    )
  );

// Native drag events exercise the same handle/drop handlers without depending
// on a browser's drag-distance threshold or autoscroll timing.
const dragBefore = async (page: Page, name: string, target: string) => {
  const row = segmentRow(page, name);
  const destination = segmentRow(page, target);
  const handle = row.locator('.reorder-handle');
  await handle.evaluate(
    (source, to) => {
      const dataTransfer = new DataTransfer();
      const bounds = to!.getBoundingClientRect();
      source.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, dataTransfer })
      );
      to!.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientY: bounds.top + 1,
        })
      );
    },
    await destination.elementHandle()
  );
  await expect(destination).toHaveAttribute('data-drop-position', 'before');
  expect(
    await destination.evaluate(
      (element) => getComputedStyle(element).borderTopColor
    )
  ).not.toBe('rgba(0, 0, 0, 0)');
  await handle.evaluate(
    (source, to) => {
      const dataTransfer = new DataTransfer();
      to!.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientY: to!.getBoundingClientRect().top + 1,
        })
      );
      source.dispatchEvent(
        new DragEvent('dragend', { bubbles: true, dataTransfer })
      );
    },
    await destination.elementHandle()
  );
};

test.describe('Segment shortcuts and ordering', () => {
  test('keeps segment shortcuts on the clicked image while hovering other views', async ({
    page,
    volview,
    utils,
    segmentation,
  }) => {
    const first = utils.writeMetaImage('shortcut-first.mha');
    const second = utils.writeMetaImage('shortcut-second.mha');
    await utils.writeManifestToFile(
      { segments: { Tumor: {}, Liver: {}, Kidney: {} } },
      'shortcut-segments.json'
    );
    await volview.open(
      `?urls=[tmp/${first},tmp/${second},tmp/shortcut-segments.json]`
    );
    await volview.waitForViews();
    await segmentation.dropImageOnView(first, 0);
    await segmentation.dropImageOnView(second, 1);
    await segmentation.openAnnotationSegments();
    await volview.activatePaint();

    const firstCanvas = page.locator('.grid-item').nth(0).locator('canvas');
    const secondCanvas = page.locator('.grid-item').nth(1).locator('canvas');
    await firstCanvas.click();
    await expect(segmentation.segmentImageName()).toHaveText(first);
    await page.keyboard.press('3');
    await expect(selected(page)).toHaveAttribute('aria-label', 'Kidney');

    await utils.moveToElement(secondCanvas);
    await expect(segmentation.segmentImageName()).toHaveText(first);
    await page.keyboard.press('q');
    await expect(selected(page)).toHaveAttribute('aria-label', 'Liver');

    await secondCanvas.click();
    await expect(segmentation.segmentImageName()).toHaveText(second);
    await page.keyboard.press('3');
    await expect(selected(page)).toHaveAttribute('aria-label', 'Kidney');
    await utils.moveToElement(firstCanvas);
    await expect(segmentation.segmentImageName()).toHaveText(second);
    await page.keyboard.press('w');
    await expect(selected(page)).toHaveAttribute('aria-label', 'Tumor');

    await firstCanvas.click();
    await expect(segmentation.segmentImageName()).toHaveText(first);
    await expect(selected(page)).toHaveAttribute('aria-label', 'Liver');
    await secondCanvas.click();
    await expect(selected(page)).toHaveAttribute('aria-label', 'Tumor');
  });

  test('cycles forward and backward across segment boundaries for polygon and paint', async ({
    page,
    volview,
    utils,
    segmentation,
  }) => {
    await volview.open();
    await segmentation.openAnnotationSegments();
    const create = segmentation.createSegmentRow();
    await expect(create).toBeDisabled();
    await page.keyboard.press('w');
    await page.keyboard.press('q');
    await expect(create).toBeDisabled();
    expect(await segmentation.segmentNames()).toEqual([]);
    expect(await volview.getNotificationsCount()).toBe(0);

    await utils.openUrls([ONE_CT_SLICE_DICOM]);
    await segmentation.openAnnotationSegments();
    await page.keyboard.press('w');
    await page.keyboard.press('q');
    expect(await segmentation.segmentNames()).toEqual([]);

    for (let index = 0; index < 3; index++) await segmentation.addSegment();
    for (const icon of ['mdi-pentagon-outline', 'mdi-brush']) {
      await volview.selectTool(icon);
      await segmentation.selectSegment('Segment 1');
      await page.keyboard.press('q');
      await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 3');
      await page.keyboard.press('w');
      await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 1');
      await page.keyboard.press('w');
      await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 2');
      await expect(volview.saveSegmentsButtons.first()).toBeDisabled();
    }
  });

  test('cycles from the first row when a restored session names no selection', async ({
    page,
    scratch,
    volview,
    utils,
    segmentation,
  }) => {
    await utils.openUrls([ONE_CT_SLICE_DICOM]);
    await segmentation.openAnnotationSegments();
    for (let index = 0; index < 3; index++) await segmentation.addSegment();
    const saved = await volview.saveSession();
    const { zip } = await utils.readSavedSessionWithoutSelection(saved);
    const name = 'segment-shortcuts-no-selection.volview.zip';
    scratch.writeFile(name, await zip.generateAsync({ type: 'nodebuffer' }));

    for (const [key, expected] of [
      ['w', 'Segment 2'],
      ['q', 'Segment 3'],
    ]) {
      await utils.openVolViewPage(name);
      await segmentation.openAnnotationSegments();
      await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 1');
      await page.keyboard.press(key);
      await expect(selected(page)).toHaveAttribute('aria-label', expected);
    }
  });

  for (const [tool, icon] of [
    ['Paint', 'mdi-brush'],
    ['Polygon', 'mdi-pentagon-outline'],
    ['Rectangle', 'mdi-vector-square'],
    ['Ruler', 'mdi-ruler'],
  ]) {
    test(`keeps the selection when ${tool} is reactivated without creating painted content`, async ({
      page,
      volview,
      utils,
      segmentation,
    }) => {
      await utils.openUrls([ONE_CT_SLICE_DICOM]);
      await volview.selectTool(icon);
      await segmentation.openAnnotationSegments();
      expect(await segmentation.segmentNames()).toEqual([]);
      await segmentation.addSegment();
      await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 1');
      expect(await segmentation.segmentNames()).toEqual(['Segment 1']);
      await expect(volview.saveSegmentsButtons.first()).toBeDisabled();
      await volview.selectTool('mdi-cursor-default');
      await volview.selectTool(icon);
      await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 1');
      expect(await segmentation.segmentNames()).toEqual(['Segment 1']);

      await segmentation.addSegment();
      await volview.selectTool('mdi-cursor-default');
      await volview.selectTool(icon);
      await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 2');
      expect(await segmentation.segmentNames()).toEqual([
        'Segment 1',
        'Segment 2',
      ]);
      await expect(volview.saveSegmentsButtons.first()).toBeDisabled();
    });
  }

  test('selects the first ten rows, follows reordered rows keeps typed digits in fields and restores saved order', async ({
    page,
    volview,
    utils,
    segmentation,
  }) => {
    await utils.openUrls([ONE_CT_SLICE_DICOM]);
    await segmentation.openAnnotationSegments();
    for (let i = 0; i < 11; i++) {
      await segmentation.createSegmentRow().click();
      await expect(segmentRow(page, `Segment ${i + 1}`)).toBeAttached();
    }

    for (let i = 1; i <= 10; i++) {
      await page.keyboard.press(String(i % 10));
      await expect(selected(page)).toHaveAttribute(
        'aria-label',
        `Segment ${i}`
      );
      await expect(segmentRow(page, `Segment ${i}`).locator('kbd')).toHaveText(
        String(i % 10)
      );
    }
    await expect(
      segmentRow(page, 'Segment 11').locator('kbd')
    ).not.toBeAttached();

    await dragBefore(page, 'Segment 11', 'Segment 1');
    await expect.poll(async () => (await titles(page))[0]).toBe('Segment 11');
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 10');
    await page.keyboard.press('1');
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 11');
    await page.keyboard.press('0');
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 9');
    await expect(
      segmentRow(page, 'Segment 10').locator('kbd')
    ).not.toBeAttached();

    const firstHandle = segmentRow(page, 'Segment 11').locator(
      '.reorder-handle'
    );
    await firstHandle.click();
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(async () => (await titles(page))[1]).toBe('Segment 11');
    await page.keyboard.press('1');
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 1');

    await segmentRow(page, 'Segment 1')
      .locator('[data-testid="edit-segment-button"]')
      .click();
    const input = page
      .locator('div[role="dialog"] .v-text-field input')
      .first();
    await input.click();
    await input.pressSequentially('1234567890');
    await expect(input).toHaveValue('Segment 11234567890');
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 1');
    await volview.editLabelModalDoneButton.click();
    await expect(selected(page)).toHaveAttribute(
      'aria-label',
      'Segment 11234567890'
    );
    const order = await titles(page);
    const session = await volview.saveSession();
    await volview.open(`?urls=[tmp/${session}]`);
    await volview.waitForViews();
    await segmentation.openAnnotationSegments();
    await expect
      .poll(async () => (await titles(page)).length)
      .toBe(order.length);
    expect(await titles(page)).toEqual(order);
    await expect(selected(page)).toHaveAttribute(
      'aria-label',
      'Segment 11234567890'
    );
    await page.keyboard.press('2');
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 11');
    await page.keyboard.press('0');
    await expect(selected(page)).toHaveAttribute('aria-label', 'Segment 9');
  });
});
