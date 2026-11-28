import { test, expect } from '../fixtures';
import { PROSTATEX_DATASET } from '../datasets';
import { HIDE_VIEW_ANNOTATIONS } from '../pageobjects/volview.page';

const MAX_MISMATCH_RATIO = 0.0001;

test.describe('Paint tool rendering', () => {
  test('should not black out axial view after painting', async ({
    page,
    volview,
    utils,
    annotation,
  }) => {
    await utils.openUrls([PROSTATEX_DATASET]);

    const axialView = volview.views2D.first();

    await volview.activatePaint();

    const canvas = axialView.locator('canvas');
    const { centerX, centerY } = await annotation.dragFromViewCenter(
      axialView,
      [[50, 30]]
    );

    for (let i = 0; i < 5; i++)
      await page.mouse.move(Math.round(centerX + i * 20), Math.round(centerY));

    const canvasImage = () =>
      canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
    const hovered = await canvasImage();
    await annotation.moveTo(10, 10);
    await expect
      .poll(canvasImage, {
        message: 'Brush preview should disappear when leaving the view',
      })
      .not.toBe(hovered);
    const withoutPreview = await canvasImage();

    await expect(
      axialView,
      `Painted axial view should match its baseline within ${MAX_MISMATCH_RATIO * 100}%`
    ).toHaveScreenshot('paint_tool_axial_view_after_stroke.png', {
      stylePath: HIDE_VIEW_ANNOTATIONS,
      maxDiffPixelRatio: MAX_MISMATCH_RATIO,
    });

    await annotation.moveTo(centerX - 60, centerY);
    await expect
      .poll(canvasImage, {
        message: 'Brush preview should appear without painting',
      })
      .not.toBe(withoutPreview);
    const firstPreview = await canvasImage();
    await annotation.moveTo(centerX - 30, centerY);
    await expect
      .poll(canvasImage, {
        message: 'Brush preview should follow the pointer without painting',
      })
      .not.toBe(firstPreview);

    await annotation.moveTo(10, 10);
    await expect
      .poll(canvasImage, {
        message: 'Moving the preview should leave the painted image unchanged',
      })
      .toBe(withoutPreview);
  });
});
