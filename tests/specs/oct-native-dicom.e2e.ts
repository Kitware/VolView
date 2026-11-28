import fs from 'node:fs';
import path from 'node:path';
import type { Locator } from '@playwright/test';
import { test, expect, useReferenceLines } from '../fixtures';
import { JHU_RETINAL_LAYERS, RETINAL_OCT_DICOM } from '../datasets';
import {
  waitForTransitions,
  type VolViewPage,
} from '../pageobjects/volview.page';
import native from '../fixtures/oct/heidelberg-reference.json' with { type: 'json' };
import type { ImageCacheUtils } from './imageCacheUtils';
import {
  canvasAppearance,
  displayedWindow,
  CANVAS,
  type OctUtils,
} from './octTestUtils';

async function canvasImage(view: Locator) {
  return canvasAppearance(view.locator('canvas').first());
}

async function openNativeDicom(
  volview: VolViewPage,
  oct: OctUtils,
  imageCache: ImageCacheUtils
) {
  await volview.open('?urls=[tmp/' + RETINAL_OCT_DICOM.name + ']');
  await volview.waitForViews();
  await imageCache.waitForFirstCachedImageSpacing();
  await oct.selectTwoRowLayout();
  await volview.waitForViewCounts(2, false);
  await oct.selectEnFace(1);
  await oct.waitForEnFaceReady();
  await volview.waitForViewCounts(1, false);
}

async function magnifyNativeCenter(canvas: Locator, oct: OctUtils) {
  await oct.toolButton('Zoom').click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The en face canvas is not on screen');
  const height = box.height;
  const maximumDrag = Math.floor(box.y + height / 2 - 8);
  let transform = await oct.projectionTransform();
  let scale = Math.hypot(transform[0], transform[1]);
  for (let step = 0; step < 6 && scale < 100; step++) {
    const previousScale = scale;
    const dragY = -Math.min(
      maximumDrag,
      Math.ceil(((128 / scale - 1) * height) / 1.5)
    );
    await oct.dragContrast(canvas, 0, dragY);
    await expect
      .poll(
        async () => {
          transform = await oct.projectionTransform();
          scale = Math.hypot(transform[0], transform[1]);
          return scale > previousScale;
        },
        { message: 'The Zoom gesture must enlarge the native central voxel' }
      )
      .toBe(true);
  }
  expect(scale).toBeGreaterThanOrEqual(100);
}

async function centerNativePixel(
  canvas: Locator,
  oct: OctUtils,
  point: { x: number; z: number }
) {
  const size = await canvas.boundingBox();
  if (!size) throw new Error('The en face canvas is not on screen');
  const offset = async () => {
    const [a, b, c, d, e, f] = await oct.projectionTransform();
    return {
      x: size.width / 2 - a * (point.x + 0.5) - c * (point.z + 0.5) - e,
      y: size.height / 2 - b * (point.x + 0.5) - d * (point.z + 0.5) - f,
    };
  };
  await oct.toolButton('Pan').click();
  for (let step = 0; step < 4; step++) {
    const delta = await offset();
    const distance = Math.hypot(delta.x, delta.y);
    if (distance <= 1) return;
    const bound = (value: number, extent: number) =>
      Math.round(Math.max(-extent * 0.4, Math.min(extent * 0.4, value)));
    await oct.dragContrast(
      canvas,
      bound(delta.x, size.width),
      bound(delta.y, size.height)
    );
    await expect
      .poll(
        async () => {
          const next = await offset();
          return Math.hypot(next.x, next.y) < distance;
        },
        {
          message: 'Pan must move the native reference pixel toward the center',
        }
      )
      .toBe(true);
  }
  const remaining = await offset();
  expect(Math.hypot(remaining.x, remaining.y)).toBeLessThanOrEqual(1);
}

test.describe('Public OCT exports', () => {
  useReferenceLines();
  test.beforeEach(({ utils }) => utils.useCachedSample(JHU_RETINAL_LAYERS));

  test('loads retinal layers from a ZIP URL or sample card and projects a layer on request', async ({
    page,
    volview,
    oct,
    segmentation,
  }) => {
    const names = [
      'Retinal nerve fiber layer (RNFL)',
      'Ganglion cell and inner plexiform layers (GCL+IPL)',
      'Inner nuclear layer (INL)',
      'Outer plexiform layer (OPL)',
      'Outer nuclear layer (ONL)',
      'Photoreceptor inner segments (IS)',
      'Photoreceptor outer segments (OS)',
      'Retinal pigment epithelium (RPE)',
    ];
    for (const fromSample of [false, true]) {
      await volview.open(
        fromSample ? '/' : '?urls=[tmp/' + JHU_RETINAL_LAYERS.name + ']'
      );
      await volview.waitForViewCounts(3, true);
      if (fromSample) {
        const sample = volview.samplesList.locator(
          'div[title="Retinal OCT layers"]'
        );
        await expect(sample).toBeVisible();
        await expect(sample).toBeEnabled();
        await expect(
          volview.samplesList.locator('div[title="Retinal OCT"]')
        ).not.toBeAttached();
        await sample.click();
      }
      await volview.waitForViews();
      await expect(
        page.locator('.image-list-card:has([title="jhu-hc01.nrrd"])')
      ).toHaveClass(/\bimage-list-card-active\b/);
      await segmentation.openAnnotationSegments();
      await segmentation.waitForSegmentContent(names[7]);
      expect(await segmentation.segmentNames()).toEqual(names);
      await volview.waitForViewCounts(3, true);
      expect(
        await page
          .locator('.view-type-select input')
          .evaluateAll((inputs) =>
            inputs.map((input) => (input as HTMLInputElement).value)
          )
      ).toEqual(['Axial', 'Coronal', 'Sagittal', 'Volume']);
      expect(await page.locator(CANVAS).count()).toBe(0);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const source = document.querySelector<HTMLCanvasElement>(
              'div[data-testid~="vtk-two-view"] canvas'
            )!;
            const copy = document.createElement('canvas');
            copy.width = source.width;
            copy.height = source.height;
            const context = copy.getContext('2d')!;
            context.drawImage(source, 0, 0);
            const pixels = context.getImageData(
              0,
              0,
              copy.width,
              copy.height
            ).data;
            let colored = 0;
            for (let i = 0; i < pixels.length; i += 4)
              if (
                Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
                  Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >
                40
              )
                colored++;
            return colored > 200;
          })
        )
        .toBe(true);
      expect(await volview.getNotificationsCount()).toBe(0);
    }

    await oct.selectEnFace(1);
    await oct.waitForEnFaceReady();
    await oct.openEnFaceControls();
    for (const section of ['projection', 'segments'])
      await expect(
        page.locator('[data-testid="enface-' + section + '-toggle"]')
      ).toHaveAttribute('aria-expanded', 'true');
    await oct.expandEnFaceSection('projection');
    await oct.selectSetting('enface-projection-axis', 'Coronal');
    await oct.expandEnFaceSection('segments');
    for (const name of names)
      await expect(oct.segmentEye(name)).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    await expect(oct.segmentEye(names[2])).toBeEnabled();
    await oct.setSegmentShown(names[2], true);
    await expect(oct.segmentThresholdSlider(names[2])).toHaveAttribute(
      'aria-valuemax',
      '58.1'
    );
    await oct.setSegmentThreshold(names[2], 20);
    await expect(oct.segmentThresholdSlider(names[2])).toHaveAttribute(
      'aria-valuenow',
      '20'
    );
    const projectionToggle = page.locator(
      '.v-overlay--active [data-testid="enface-projection-toggle"]'
    );
    const projectionContent = projectionToggle
      .locator('..')
      .locator('.v-expansion-panel-text');
    await projectionToggle.click();
    await expect(projectionContent).toBeHidden();
    await expect(
      page.locator('.v-overlay--active [data-testid="enface-segments-toggle"]')
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(oct.segmentThreshold(names[2])).toHaveValue('20');
    const captureDirectory = process.env.VOLVIEW_OCT_CAPTURE_DIR;
    if (captureDirectory) {
      fs.mkdirSync(captureDirectory, { recursive: true });
      await page.screenshot({
        path: path.join(captureDirectory, 'jhu-en-face-controls.png'),
      });
    }
    await page.keyboard.press('Escape');
    await oct.expectHighlight(true);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('keeps source contrast and pixels when replacing an independently windowed projection', async ({
    page,
    volview,
    utils,
    oct,
    imageCache,
  }) => {
    await openNativeDicom(volview, oct, imageCache);
    if (
      ((await page.locator('#left-nav').getAttribute('class')) ?? '').includes(
        'v-navigation-drawer--active'
      )
    )
      await page.locator('header .mdi-menu').click();
    const source = volview.views2D.first();
    const sourceCanvas = source.locator('canvas').first();
    const windowTool = page.locator(
      'button[data-testid^="control-button-Window & Level "]'
    );
    if (
      !((await windowTool.getAttribute('class')) ?? '').includes(
        'tool-btn-selected'
      )
    )
      await windowTool.click();
    await waitForTransitions(sourceCanvas);
    const initialWindow = await displayedWindow(source);
    const initialImage = await canvasImage(source);
    await expect(sourceCanvas).toBeVisible();
    await expect(sourceCanvas).toBeEnabled();
    await oct.dragContrast(sourceCanvas, 65, 45);
    await expect
      .poll(async () => {
        const window = await displayedWindow(source);
        return (
          window.width !== initialWindow.width &&
          window.level !== initialWindow.level &&
          (await canvasImage(source)).image !== initialImage.image
        );
      })
      .toBe(true);
    const canvas = page.locator(CANVAS).first();
    const projectionImage = () =>
      canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
    const projectionBefore = await projectionImage();
    await waitForTransitions(canvas);
    await oct.dragContrast(canvas, -50, 40);
    await expect.poll(projectionImage).not.toBe(projectionBefore);
    const beforeWindow = await displayedWindow(source);
    const beforeImage = await canvasImage(source);
    // Require over 1000 actual pixels with at least one RGB channel above 20.
    expect(beforeImage.visiblePixels).toBeGreaterThan(1000);
    await page
      .locator('[data-testid="enface-viewer"] .view-type-select .v-field')
      .click();
    await utils.overlayOption('Axial').click();
    await expect(page.locator(CANVAS)).not.toBeAttached();
    await volview.waitForViewCounts(2, false);
    const replacement = volview.views2D.nth(1);
    await expect
      .poll(async () => (await canvasImage(replacement)).visiblePixels)
      .toBeGreaterThan(1000);
    expect(await displayedWindow(source)).toEqual(beforeWindow);
    expect(await displayedWindow(replacement)).toEqual(beforeWindow);
    expect((await canvasImage(source)).image).toBe(beforeImage.image);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
  test('loads the native Heidelberg DICOM fixture with calibrated stacked views', async ({
    volview,
    oct,
    imageCache,
  }) => {
    await openNativeDicom(volview, oct, imageCache);
    const spacing = await imageCache.waitForFirstCachedImageSpacing();
    spacing.forEach((value, axis) =>
      expect(value).toBeCloseTo(native.spacing[axis], 6)
    );
    const fullProjection = await oct.enFaceAppearance();
    await oct.openEnFaceProjection();
    await oct.setSlabRange(100, 300);
    await expect
      .poll(async () => (await oct.enFaceAppearance()).image)
      .not.toBe(fullProjection.image);
    await oct.waitForEnFaceReady();
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  for (const scenario of [
    { name: 'Mean', method: 'Mean', field: 'mean', width: 255 },
    { name: 'Maximum', method: 'Maximum', field: 'max', width: 255 },
    { name: 'Sum', method: 'Sum', field: 'sum', width: 100000 },
    {
      name: 'partial slab Mean',
      method: 'Mean',
      field: 'slab100to300mean',
      width: 255,
    },
  ] as const) {
    test(
      'matches independent native Heidelberg ' + scenario.name + ' pixels',
      async ({ page, volview, oct, octInteraction, imageCache }) => {
        await page.setViewportSize({ width: 1280, height: 400 });
        await openNativeDicom(volview, oct, imageCache);
        await oct.chooseEnFaceProjection(
          'enface-projection-method',
          scenario.method
        );
        if (scenario.field === 'slab100to300mean') {
          await oct.setEnFaceSlab(100, 300);
        }
        await oct.waitForEnFaceReady();
        await oct.setEnFaceWindow(scenario.width, scenario.width / 2);
        const canvas = page.locator(CANVAS).first();
        await magnifyNativeCenter(canvas, oct);
        const sample = native.physicalSlabSampling.projectionSamples[2];
        await centerNativePixel(canvas, oct, sample);
        const gray = Math.round(
          (sample[scenario.field] / scenario.width) * 255
        );
        expect(gray).toBeGreaterThan(0);
        expect(gray).toBeLessThan(255);
        await octInteraction.expectProjectionPixel(gray, sample.x, sample.z);
        expect(await volview.getNotificationsCount()).toBe(0);
      }
    );
  }

  test('preserves the configured volume layout when loading retinal layers with disabled view types', async ({
    page,
    volview,
    utils,
    imageCache,
  }) => {
    for (const disabled of ['2D', 'EnFace']) {
      const configName = 'oct-disable-' + disabled + '.json';
      await utils.writeManifestToFile(
        {
          layouts: { 'Allowed volume': [['volume']] },
          disabledViewTypes: [disabled],
        },
        configName
      );
      await volview.open('?urls=[tmp/' + configName + ']');
      await volview.waitForViewCounts(0, true);
      const sample = volview.samplesList.locator(
        'div[title="Retinal OCT layers"]'
      );
      await sample.click();
      await imageCache.waitForFirstCachedImageSpacing();
      await volview.waitForViewCounts(0, true);
      expect(await page.locator(CANVAS).count()).toBe(0);
      expect(
        await page.locator('.view-type-select input').first().inputValue()
      ).toBe('Volume');
      expect(await volview.getNotificationsCount()).toBe(0);
    }
  });
});
