import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures';
import { waitForTransitions } from '../pageobjects/volview.page';

const previewImageAt = (canvas: Locator, point: { x: number; y: number }) =>
  canvas.evaluate(async (source, position) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    const paintCanvas = source as HTMLCanvasElement;
    const viewRect = paintCanvas.getBoundingClientRect();
    const x = Math.round(
      ((position.x - viewRect.left) * paintCanvas.width) / viewRect.width
    );
    const y = Math.round(
      ((position.y - viewRect.top) * paintCanvas.height) / viewRect.height
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
  }, point);

test.describe('Paint preview color', () => {
  test('previews the color of the next stroke after deleting every segment', async ({
    page,
    volview,
    utils,
    annotation,
    segmentation,
  }) => {
    const imageName = utils.writeMetaImage('paint-preview-color.mha', {
      size: 70,
    });
    await utils.writeManifestToFile(
      { layouts: { Axial: [['axial']] } },
      'paint-preview-color-config.json'
    );
    await utils.writeManifestToFile(
      {
        resources: [
          { url: '/tmp/' + imageName },
          { url: '/tmp/paint-preview-color-config.json' },
        ],
      },
      'paint-preview-color.json'
    );
    await utils.openVolViewPage('paint-preview-color.json');
    await volview.waitForViewCounts(1, false);
    await volview.activatePaint();
    await segmentation.openAnnotationSegments();

    const size = page.locator('[role="slider"][aria-label="Brush size"]');
    await size.focus();
    await page.keyboard.press('End');

    const canvas = volview.views2D.first().locator('canvas');
    await waitForTransitions(canvas);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('The view has no canvas on screen');
    const previewPoint = {
      x: Math.round(box.x + box.width * 0.4),
      y: Math.round(box.y + box.height * 0.5),
    };
    const strokePoint = {
      x: Math.round(box.x + box.width * 0.6),
      y: previewPoint.y,
    };
    const move = (point: { x: number; y: number }) =>
      annotation.moveTo(point.x, point.y);
    const stroke = () => annotation.clickAt(strokePoint.x, strokePoint.y);
    const previewImage = () => previewImageAt(canvas, previewPoint);

    await stroke();
    await expect
      .poll(async () => (await segmentation.segmentNames()).length)
      .toBe(1);
    await segmentation.deleteSegment((await segmentation.segmentNames())[0]);
    expect(await segmentation.segmentNames()).toEqual([]);

    await move({ x: 10, y: 10 });
    const background = await previewImage();
    await move(previewPoint);
    await expect
      .poll(previewImage, {
        message: 'Expected the empty-list brush preview to be visible',
      })
      .not.toBe(background);
    const beforeStroke = await previewImage();

    await stroke();
    await expect
      .poll(async () => (await segmentation.segmentNames()).length)
      .toBe(1);
    await move(previewPoint);
    await expect
      .poll(previewImage, {
        message: 'Expected the next stroke to use the previewed brush color',
      })
      .toBe(beforeStroke);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('previews the color its first stroke paints before first activating an inactive image', async ({
    page,
    volview,
    utils,
    scratch,
    annotation,
    segmentation,
  }) => {
    const first = utils.writeMetaImage('paint-copy-preview-first.mha', {
      size: 70,
    });
    const second = utils.writeMetaImage('paint-copy-preview-second.mha', {
      size: 70,
    });
    await volview.open(`?urls=[tmp/${first},tmp/${second}]`);
    await volview.waitForViews();
    await segmentation.dropImageOnView(first, 0);
    await segmentation.dropImageOnView(second, 1);
    await page.locator('.grid-item').nth(0).locator('canvas').click();

    // An ordinary manifest can display both images without saved segment sets.
    const { zip, manifest } = await utils.readSavedSessionWithoutSelection(
      await volview.saveSession()
    );
    delete manifest.imageSegments;
    delete manifest.segmentationArtifacts;
    zip.file('manifest.json', JSON.stringify(manifest));
    const archive = scratch.writeFile(
      'paint-copy-preview.volview.zip',
      await zip.generateAsync({ type: 'nodebuffer' })
    );
    await volview.open();
    await utils.openThroughDialog(archive);
    await volview.waitForViews();

    await segmentation.openAnnotationSegments();
    await segmentation.addSegment();
    await segmentation.addSegment();
    await segmentation.renameSegment(
      (await segmentation.segmentNames())[1],
      'Chosen'
    );
    await segmentation.selectSegment('Chosen');
    await volview.activatePaint();
    await expect(segmentation.segmentImageName()).toHaveText(first);

    const canvas = page.locator('.grid-item').nth(1).locator('canvas');
    await waitForTransitions(canvas);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('The view has no canvas on screen');
    const point = {
      x: Math.round(box.x + box.width * 0.3),
      y: Math.round(box.y + box.height * 0.5),
    };
    const image = () => previewImageAt(canvas, point);
    await annotation.moveTo(10, 10);
    const background = await image();
    await annotation.moveTo(point.x, point.y);
    await expect
      .poll(image, {
        message: 'Expected a brush preview on the inactive image',
      })
      .not.toBe(background);
    const beforeStroke = await image();
    await expect(segmentation.segmentImageName()).toHaveText(first);

    await annotation.clickAt(box.x + box.width * 0.7, point.y);
    await expect(segmentation.segmentImageName()).toHaveText(second);
    await expect
      .poll(async () => (await segmentation.segmentNames()).length)
      .toBe(1);
    await annotation.moveTo(point.x, point.y);
    await expect
      .poll(image, {
        message: 'Expected the minted segment to keep the previewed color',
      })
      .toBe(beforeStroke);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
