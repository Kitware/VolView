import { volViewPage } from '../pageobjects/volview.page';
import { ONE_CT_SLICE_DICOM } from '../datasets';
import { openUrls } from './utils';
import {
  addSegment,
  allowOverlap,
  deleteSegment,
  openAnnotationSegments,
} from './segmentationTestUtils';
import { nudgeTo, pressAtPointer } from './annotationTestUtils';

const row = (name: string) =>
  $(`[data-testid="segment-list"] .item-row[aria-label="${name}"]`);
const selected = () =>
  $('[data-testid="segment-list"] .item-row[aria-current="true"]');
const eyedropper = () => $('[data-testid="paint-eyedropper-button"]');
const mouse = () => browser.action('pointer', { id: 'paint-mouse' });
const keyboard = () => browser.action('key', { id: 'paint-keyboard' });
const click = (x: number, y: number) =>
  mouse().move({ x, y }).down().up().perform(true);

const expectBackgroundUnpainted = async (x: number, y: number) => {
  await row('Segment 3').click();
  await eyedropper().click();
  await click(x, y);
  await expect(selected()).toHaveAttribute('aria-label', 'Segment 3');
};

const openPaintedScene = async () => {
  await openUrls([ONE_CT_SLICE_DICOM]);
  await volViewPage.activatePaint();
  await openAnnotationSegments();
  const view = (await volViewPage.getViews2D())[0];
  const canvas = view.$('canvas');
  const location = await canvas.getLocation();
  const size = await canvas.getSize();
  const x = Math.round(location.x + size.width / 2);
  const y = Math.round(location.y + size.height / 2);
  await click(x, y);
  await expect(
    row('Segment 1').$('[data-testid="reveal-segment-button"]')
  ).toBeEnabled();
  return { view, canvas, x, y };
};

describe('Paint eyedropper', () => {
  afterEach(async () => {
    await browser.releaseActions();
  });

  for (const [tool, icon] of [
    ['ruler', 'mdi-ruler'],
    ['rectangle', 'mdi-vector-square'],
  ]) {
    it(`samples painted content after switching from a picked ${tool} handle`, async () => {
      const { view, canvas, x, y } = await openPaintedScene();
      await addSegment();
      await expect(selected()).toHaveAttribute('aria-label', 'Segment 2');
      await expect(
        row('Segment 2').$('[data-testid="reveal-segment-button"]')
      ).toBeDisabled();

      await volViewPage.selectTool(icon);
      await nudgeTo(x + 60, y - 60);
      await pressAtPointer();
      await nudgeTo(x + 90, y - 30);
      await pressAtPointer();
      await volViewPage.selectTool('mdi-cursor-default');
      await expect(view.$$('svg circle')).toBeElementsArrayOfSize(2);
      await nudgeTo(x - 50, y + 50);
      await browser.waitUntil(
        async () => (await canvas.getCSSProperty('cursor')).value === 'default'
      );
      await nudgeTo(x + 60, y - 60);
      await browser.waitUntil(
        async () => (await canvas.getCSSProperty('cursor')).value === 'pointer'
      );

      await volViewPage.activatePaint();
      await eyedropper().click();
      await expect(eyedropper()).toHaveAttribute('aria-pressed', 'true');
      await browser.waitUntil(async () =>
        String((await canvas.getCSSProperty('cursor')).value).startsWith('url(')
      );
      await nudgeTo(x, y);
      await pressAtPointer();
      await expect(selected()).toHaveAttribute('aria-label', 'Segment 1');

      // Removing the painted segment leaves only the annotation, with no mask to save.
      await deleteSegment('Segment 1');
      await expect(row('Segment 2')).toExist();
      await expect(volViewPage.saveSegmentsButtons[0]).toBeDisabled();
    });
  }

  it('picks visible label maps without painting and restores the held mode', async () => {
    const { canvas, x, y } = await openPaintedScene();
    await allowOverlap();
    await $('[data-testid="segment-list"] .create-row').click();
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 2');
    await click(x, y);
    await $('[data-testid="segment-list"] .create-row').click();
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 3');

    const list = $('[data-testid="segment-list"] .item-list-scroll');
    await browser.execute(
      (element) => {
        element.style.maxHeight = '64px';
        element.scrollTop = element.scrollHeight;
      },
      await list
    );
    const selectedRowInView = async () =>
      browser.execute(
        (element) => {
          const selectedRow = element.querySelector('[aria-current="true"]')!;
          const bounds = element.getBoundingClientRect();
          const item = selectedRow.getBoundingClientRect();
          return item.top >= bounds.top && item.bottom <= bounds.bottom;
        },
        await list
      );

    await eyedropper().click();
    await expect(eyedropper()).toHaveAttribute('aria-pressed', 'true');
    await click(x, y);
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 1');
    await browser.waitUntil(selectedRowInView);
    await browser.execute(
      (element) => {
        element.scrollTop = element.scrollHeight;
      },
      await list
    );
    expect(await selectedRowInView()).toBe(false);
    await click(x, y);
    await browser.waitUntil(selectedRowInView);
    await row('Segment 1').$('.reorder-handle').click();
    await browser.keys(['Alt', 'ArrowDown']);
    await expect(row('Segment 2').$('kbd')).toHaveText('1');
    await click(x, y);
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 2');
    await browser.waitUntil(selectedRowInView);
    await row('Segment 2').$('button[aria-label="Hide Segment 2"]').click();
    await click(x, y);
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 1');
    await click(x + 70, y);
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 1');

    await row('Segment 2').$('button[aria-label="Show Segment 2"]').click();
    await browser.keys('e');
    await row('Segment 3').click();
    await keyboard().down('d').perform(true);
    await expect(eyedropper()).toHaveAttribute('aria-pressed', 'true');
    await browser.waitUntil(async () =>
      String((await canvas.getCSSProperty('cursor')).value).startsWith('url(')
    );
    await mouse().move({ x, y }).down().perform(true);
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 2');
    await keyboard().up('d').perform(true);
    await expect(eyedropper()).toHaveAttribute('aria-pressed', 'false');
    await expect($('button.mode-button.selected')).toHaveText('Erase');
    await mouse()
      .move({ x: x + 70, y })
      .up()
      .perform(true);

    // Sampling leaves background untouched and the painted segment pickable.
    await expectBackgroundUnpainted(x + 70, y);
    await click(x, y);
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 2');

    await browser.keys('p');
    await mouse().move({ x, y }).down().perform(true);
    await keyboard().down('d').perform(true);
    await expect(eyedropper()).toHaveAttribute('aria-pressed', 'true');
    await mouse()
      .move({ x: x + 70, y })
      .perform(true);
    await keyboard().up('d').perform(true);
    await mouse()
      .move({ x: x + 80, y })
      .up()
      .perform(true);
    await expectBackgroundUnpainted(x + 70, y);
    await click(x + 80, y);
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 3');

    await browser.keys('p');
    await row('Segment 3').$('[data-testid="edit-segment-button"]').click();
    const input = $('div[role="dialog"] .v-text-field input');
    await input.click();
    await keyboard().down('d').perform(true);
    await expect(input).toHaveValue('Segment 3d');
    await expect(eyedropper()).toHaveAttribute('aria-pressed', 'false');
    await keyboard().up('d').perform(true);
  });
});
