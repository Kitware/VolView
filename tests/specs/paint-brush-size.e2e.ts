import { volViewPage } from '../pageobjects/volview.page';
import { openVolViewPage, writeManifestToFile, writeMetaImage } from './utils';

const LARGE_IMAGE = 'paint-brush-large.mha';
const SMALL_IMAGE = 'paint-brush-small.mha';

const dropOnSlot = (name: string, slotIndex: number) =>
  browser.execute(
    (imageName, index) => {
      const source = Array.from(
        document.querySelectorAll('.image-list-card')
      ).find((card) => card.textContent?.includes(imageName));
      const target = document.querySelectorAll('.grid-item')[index];
      if (!source || !target) return false;
      const data = new DataTransfer();
      source.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, dataTransfer: data })
      );
      if (!data.getData('application/x-volview-image-id')) return false;
      target.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, dataTransfer: data })
      );
      target.dispatchEvent(
        new DragEvent('drop', { bubbles: true, dataTransfer: data })
      );
      return true;
    },
    name,
    slotIndex
  );

describe('Paint brush size', () => {
  it('keeps the smaller image preview when increasing a brush already at its maximum', async () => {
    writeMetaImage(LARGE_IMAGE, { size: 70 });
    writeMetaImage(SMALL_IMAGE, { size: 21 });
    const manifest = 'paint-brush-size.json';
    await writeManifestToFile(
      {
        resources: [LARGE_IMAGE, SMALL_IMAGE].map((name) => ({
          url: `/tmp/${name}`,
        })),
      },
      manifest
    );
    await openVolViewPage(manifest);
    const largeCard = $(`.image-list-card*=${LARGE_IMAGE}`);
    const smallCard = $(`.image-list-card*=${SMALL_IMAGE}`);
    await largeCard.waitForClickable();
    await smallCard.waitForClickable();
    await largeCard.click();
    await expect($$('.grid-item')).toBeElementsArrayOfSize(4);
    const slots = await $$('.grid-item');
    expect(await dropOnSlot(SMALL_IMAGE, 2)).toBe(true);
    await browser.waitUntil(async () =>
      (await slots[2].getText()).includes(SMALL_IMAGE)
    );

    const largeCanvas = await slots[0].$('canvas');
    const smallCanvas = await slots[2].$('canvas');
    await largeCanvas.click();
    await volViewPage.activatePaint();
    await volViewPage.annotationsModuleTab.click();
    const size = $('[role="slider"][aria-label="Brush size"]');
    await expect(size).toHaveAttribute('aria-valuemax', '7');
    await browser.execute(
      (element) => (element as HTMLElement).focus(),
      await size
    );
    await browser.keys('End');
    await expect(size).toHaveAttribute('aria-valuenow', '7');
    await largeCanvas.click();

    const canvasImage = () =>
      browser.execute(async (element) => {
        // The next frame drains scheduled renders; the following frame captures them.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
        return (element as HTMLCanvasElement).toDataURL();
      }, smallCanvas);
    const withoutPreview = await canvasImage();
    await smallCanvas.moveTo();
    await expect(size).toHaveAttribute('aria-valuemax', '3');
    await expect(size).toHaveAttribute('aria-valuenow', '3');
    await browser.waitUntil(
      async () => (await canvasImage()) !== withoutPreview
    );
    const preview = await canvasImage();
    await browser.keys(']');
    await expect(size).toHaveAttribute('aria-valuenow', '3');
    expect((await canvasImage()) === preview).toBe(true);
  });
});
