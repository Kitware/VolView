import path from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import type { ChainablePromiseElement } from 'webdriverio';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  openThroughDialog,
  openVolViewPage,
  readSavedSessionWithoutSelection,
  writeManifestToFile,
  writeMetaImage,
} from './utils';
import {
  deleteSegment,
  dropImageOnView,
  openAnnotationSegments,
  selectSegment,
  segmentNames,
  selectedSegmentName,
} from './segmentationTestUtils';
import { clickAt, moveTo } from './annotationTestUtils';

const previewImageAt = (
  canvas: ChainablePromiseElement,
  point: { x: number; y: number }
) =>
  browser.execute(
    async (source, position) => {
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
    },
    canvas,
    point
  );

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
    const move = (point: { x: number; y: number }) => moveTo(point.x, point.y);
    const stroke = () => clickAt(strokePoint.x, strokePoint.y);
    const previewImage = () => previewImageAt(canvas, previewPoint);

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

  it('previews the copied selection before first activating an inactive image', async () => {
    const first = writeMetaImage('paint-copy-preview-first.mha', { size: 70 });
    const second = writeMetaImage('paint-copy-preview-second.mha', {
      size: 70,
    });
    await volViewPage.open(`?urls=[tmp/${first},tmp/${second}]`);
    await volViewPage.waitForViews();
    await dropImageOnView(second, 1);
    await $$('.grid-item')[0].$('canvas').click();

    // An ordinary manifest can display both images without saved segment sets.
    const { zip, manifest } = await readSavedSessionWithoutSelection(
      await volViewPage.saveSession()
    );
    delete manifest.segments;
    delete manifest.imageSegmentSets;
    delete manifest.seedSegmentDefaults;
    delete manifest.segmentationArtifacts;
    delete manifest.segmentations;
    zip.file('manifest.json', JSON.stringify(manifest));
    const archive = path.join(TEMP_DIR, 'paint-copy-preview.volview.zip');
    writeFileSync(archive, await zip.generateAsync({ type: 'nodebuffer' }));
    cleanuptotal.addCleanup(async () => rmSync(archive, { force: true }));
    await volViewPage.open();
    await openThroughDialog(archive);
    await volViewPage.waitForViews();

    const config = await writeManifestToFile(
      { segments: { Other: { color: 'red' }, Chosen: { color: 'lime' } } },
      'paint-copy-preview-config.json'
    );
    await openThroughDialog(config);
    await openAnnotationSegments();
    await selectSegment('Chosen');
    await volViewPage.activatePaint();
    await expect($('[data-testid="segment-image-name"]')).toHaveText(first);

    const canvas = await $$('.grid-item')[1].$('canvas');
    await canvas.waitForStable();
    const location = await canvas.getLocation();
    const bounds = await canvas.getSize();
    const point = {
      x: Math.round(location.x + bounds.width * 0.3),
      y: Math.round(location.y + bounds.height * 0.5),
    };
    const image = () => previewImageAt(canvas, point);
    await moveTo(10, 10);
    const background = await image();
    await moveTo(point.x, point.y);
    await browser.waitUntil(async () => (await image()) !== background, {
      timeoutMsg: 'Expected a brush preview on the inactive image',
    });
    const beforeStroke = await image();
    await expect($('[data-testid="segment-image-name"]')).toHaveText(first);

    await clickAt(location.x + bounds.width * 0.7, point.y);
    await expect($('[data-testid="segment-image-name"]')).toHaveText(second);
    expect(await selectedSegmentName()).toBe('Chosen');
    await moveTo(point.x, point.y);
    await browser.waitUntil(async () => (await image()) === beforeStroke, {
      timeoutMsg: 'Expected the copied selection to keep the previewed color',
    });
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
