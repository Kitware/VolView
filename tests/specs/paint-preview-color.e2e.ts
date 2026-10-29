import { volViewPage } from '../pageobjects/volview.page';
import { openVolViewPage, writeManifestToFile, writeMetaImage } from './utils';
import {
  deleteSegment,
  openAnnotationSegments,
  segmentNames,
} from './segmentationTestUtils';

describe('Paint preview color', () => {
  it('previews the color of the next stroke after deleting every segment', async () => {
    const imageName = writeMetaImage('paint-preview-color.mha', { size: 70 });
    await writeManifestToFile(
      { layouts: { Axial: [['axial']] } },
      'paint-preview-color-config.json'
    );
    await writeManifestToFile(
      {
        resources: [
          { url: '/tmp/' + imageName },
          { url: '/tmp/paint-preview-color-config.json' },
        ],
      },
      'paint-preview-color.json'
    );
    await openVolViewPage('paint-preview-color.json');
    await volViewPage.waitForViewCounts(1, false);
    await volViewPage.activatePaint();
    await openAnnotationSegments();

    const size = $('[role="slider"][aria-label="Brush size"]');
    await size.execute((element) => (element as HTMLElement).focus());
    await browser.keys('End');

    const canvas = await (await volViewPage.getViews2D())[0].$('canvas');
    await canvas.waitForStable();
    const location = await canvas.getLocation();
    const bounds = await canvas.getSize();
    const previewPoint = {
      x: Math.round(location.x + bounds.width * 0.4),
      y: Math.round(location.y + bounds.height * 0.5),
    };
    const strokePoint = {
      x: Math.round(location.x + bounds.width * 0.6),
      y: previewPoint.y,
    };
    const move = (point: { x: number; y: number }) =>
      browser.action('pointer').move(point).perform();
    const stroke = () =>
      browser.action('pointer').move(strokePoint).down().up().perform();
    const previewImage = () =>
      browser.execute(
        async (source, point) => {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
          const paintCanvas = source as HTMLCanvasElement;
          const viewRect = paintCanvas.getBoundingClientRect();
          const x = Math.round(
            ((point.x - viewRect.left) * paintCanvas.width) / viewRect.width
          );
          const y = Math.round(
            ((point.y - viewRect.top) * paintCanvas.height) / viewRect.height
          );
          const image = new Image();
          image.src = paintCanvas.toDataURL();
          await image.decode();
          const crop = document.createElement('canvas');
          crop.width = 96;
          crop.height = 96;
          crop
            .getContext('2d')!
            .drawImage(image, x - 48, y - 48, 96, 96, 0, 0, 96, 96);
          return crop.toDataURL();
        },
        canvas,
        previewPoint
      );

    await stroke();
    await browser.waitUntil(async () => (await segmentNames()).length === 1);
    await deleteSegment((await segmentNames())[0]);
    expect(await segmentNames()).toEqual([]);

    await move({ x: 10, y: 10 });
    const background = await previewImage();
    await move(previewPoint);
    await browser.waitUntil(async () => (await previewImage()) !== background, {
      timeoutMsg: 'Expected the empty-list brush preview to be visible',
    });
    const beforeStroke = await previewImage();

    await stroke();
    await browser.waitUntil(async () => (await segmentNames()).length === 1);
    await move(previewPoint);
    await browser.waitUntil(
      async () => (await previewImage()) === beforeStroke,
      {
        timeoutMsg: 'Expected the next stroke to use the previewed brush color',
      }
    );
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
