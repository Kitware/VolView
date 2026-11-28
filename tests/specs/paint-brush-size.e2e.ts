import { test, expect } from '../fixtures';
import { containsText } from '../pageobjects/volview.page';

const LARGE_IMAGE = 'paint-brush-large.mha';
const SMALL_IMAGE = 'paint-brush-small.mha';

test.describe('Paint brush size', () => {
  test('keeps the smaller image preview when increasing a brush already at its maximum', async ({
    page,
    volview,
    utils,
    segmentation,
  }) => {
    utils.writeMetaImage(LARGE_IMAGE, { size: 70 });
    utils.writeMetaImage(SMALL_IMAGE, { size: 21 });
    const manifest = 'paint-brush-size.json';
    await utils.writeManifestToFile(
      {
        resources: [LARGE_IMAGE, SMALL_IMAGE].map((name) => ({
          url: `/tmp/${name}`,
        })),
      },
      manifest
    );
    await utils.openVolViewPage(manifest);
    const largeCard = page.locator('.image-list-card', {
      hasText: containsText(LARGE_IMAGE),
    });
    const smallCard = page.locator('.image-list-card', {
      hasText: containsText(SMALL_IMAGE),
    });
    await expect(largeCard).toBeVisible();
    await expect(largeCard).toBeEnabled();
    await expect(smallCard).toBeVisible();
    await expect(smallCard).toBeEnabled();
    await largeCard.click();
    const slots = page.locator('.grid-item');
    await expect(slots).toHaveCount(4);
    await segmentation.dropImageOnView(`/tmp/${SMALL_IMAGE}`, 2);
    await expect.poll(() => slots.nth(2).innerText()).toContain(SMALL_IMAGE);

    const largeCanvas = slots.nth(0).locator('canvas');
    const smallCanvas = slots.nth(2).locator('canvas');
    await largeCanvas.click();
    await volview.activatePaint();
    await volview.annotationsModuleTab.click();
    const size = page.locator('[role="slider"][aria-label="Brush size"]');
    await expect(size).toHaveAttribute('aria-valuemax', '7');
    await size.focus();
    await page.keyboard.press('End');
    await expect(size).toHaveAttribute('aria-valuenow', '7');
    await largeCanvas.click();

    const canvasImage = () =>
      smallCanvas.evaluate(async (element) => {
        // The next frame drains scheduled renders; the following frame captures them.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
        return (element as HTMLCanvasElement).toDataURL();
      });
    const withoutPreview = await canvasImage();
    await utils.moveToElement(smallCanvas);
    await expect(size).toHaveAttribute('aria-valuemax', '7');
    await expect(size).toHaveAttribute('aria-valuenow', '7');
    await expect.poll(canvasImage).not.toBe(withoutPreview);
    const preview = await canvasImage();
    await page.keyboard.press(']');
    await expect(size).toHaveAttribute('aria-valuenow', '7');
    expect((await canvasImage()) === preview).toBe(true);

    await smallCanvas.click();
    await expect(size).toHaveAttribute('aria-valuemax', '3');
    await expect(size).toHaveAttribute('aria-valuenow', '3');
  });
});
