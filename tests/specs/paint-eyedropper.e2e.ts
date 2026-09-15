import { volViewPage } from '../pageobjects/volview.page';
import { ONE_CT_SLICE_DICOM } from './configTestUtils';
import { openUrls } from './utils';
import { openAnnotationSegments } from './segmentationTestUtils';

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

describe('Paint eyedropper', () => {
  afterEach(async () => {
    await browser.releaseActions();
  });

  it('picks visible label maps without painting and restores the held mode', async () => {
    await openUrls([ONE_CT_SLICE_DICOM]);
    await volViewPage.activatePaint();
    await openAnnotationSegments();
    await $('button.v-expansion-panel-title*=Paint').click();
    const canvas = (await volViewPage.getViews2D())[0].$('canvas');
    const location = await canvas.getLocation();
    const size = await canvas.getSize();
    const x = Math.round(location.x + size.width / 2);
    const y = Math.round(location.y + size.height / 2);

    await click(x, y);
    await expect(row('Segment 1')).toExist();
    await row('Segment 1').$('button[aria-label="Lock Segment 1"]').click();
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
