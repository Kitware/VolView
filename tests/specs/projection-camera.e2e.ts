import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, useReferenceLines } from '../fixtures';
import { syntheticScalars } from '../fixtures/oct/dicom';
import reference from '../fixtures/oct/reference.json' with { type: 'json' };
import { createNrrdVolume, syntheticMask } from '../fixtures/oct/volumes';
import {
  containsText,
  waitForTransitions,
  type VolViewPage,
} from '../pageobjects/volview.page';
import {
  canvasAppearance,
  CANVAS,
  VIEWER,
  type OctUtils,
} from './octTestUtils';
import type { Utils } from './utils';

const STEM = 'projection-camera';
const SOURCE_NAME = 'camera-source.nrrd';
const MASK_NAME = 'camera-mask.nrrd';
const SEGMENT_NAME = 'Alternative synthetic band';

type MaskGateWindow = Window & {
  maskRestoreGate: { armed: boolean; entered: boolean; release?: () => void };
};

const installMaskDecodeGate = (page: Page) =>
  page.addInitScript(() => {
    const gate: MaskGateWindow['maskRestoreGate'] = {
      armed: false,
      entered: false,
    };
    (window as unknown as MaskGateWindow).maskRestoreGate = gate;
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        if (String(args[0]).includes('async.reader.worker')) {
          worker.addEventListener('message', (event) => {
            if (!gate.armed) return;
            gate.armed = false;
            gate.entered = true;
            event.stopImmediatePropagation();
            gate.release = () => {
              gate.release = undefined;
              worker.dispatchEvent(
                new MessageEvent('message', { data: event.data })
              );
            };
          });
        }
        return worker;
      },
    });
  });

async function stageCameraScene(utils: Utils) {
  const directory = utils.makeTempDir(STEM);
  fs.writeFileSync(
    path.join(directory, SOURCE_NAME),
    createNrrdVolume({
      scalars: syntheticScalars(),
      dimensions: reference.size,
      spacing: reference.spacing,
    })
  );
  fs.writeFileSync(path.join(directory, MASK_NAME), syntheticMask());
  await utils.writeManifestToFile(
    { layouts: { 'Projection camera': [['axial'], ['enface']] } },
    STEM + '.json'
  );
}

async function openCameraScene(volview: VolViewPage, empty = false) {
  await volview.open(
    '?urls=[tmp/' +
      STEM +
      '.json' +
      (empty ? '' : ',tmp/' + STEM + '/' + SOURCE_NAME) +
      ']'
  );
}

async function panAndZoom(page: Page, oct: OctUtils) {
  await page.keyboard.press('Escape');
  await page.locator(CANVAS).click();
  const initial = await oct.projectionTransform();
  await page.locator('button[data-testid^="control-button-Pan "]').click();
  await oct.dragContrast(page.locator(CANVAS), 40, 20);
  await expect
    .poll(async () =>
      Math.abs((await oct.projectionTransform())[4] - initial[4])
    )
    .toBeGreaterThan(1);
  const panned = await oct.projectionTransform();
  await page.locator('button[data-testid^="control-button-Zoom "]').click();
  await oct.dragContrast(page.locator(CANVAS), 0, -40);
  await expect
    .poll(async () =>
      Math.abs((await oct.projectionTransform())[0] - panned[0])
    )
    .toBeGreaterThan(0.01);
  await oct.waitForEnFaceReady();
  return {
    transform: await oct.projectionTransform(),
    image: (await oct.enFaceAppearance()).image,
  };
}

type Inspected = Awaited<ReturnType<typeof panAndZoom>>;

async function expectCameraAndPixels(oct: OctUtils, inspected: Inspected) {
  await oct.waitForEnFaceReady();
  await oct.expectProjectionTransform(inspected.transform);
  await expect
    .poll(async () => (await oct.enFaceAppearance()).image, {
      message: 'Expected the saved projection pixels and camera framing',
    })
    .toBe(inspected.image);
}

const sourceCanvas = (page: Page) =>
  page.locator('div[data-testid~="vtk-two-view"] canvas').first();

async function expectSourceMaskPixels(page: Page, expectedImage?: string) {
  let image = '';
  await expect
    .poll(
      async () => {
        const rendered = await canvasAppearance(sourceCanvas(page));
        image = rendered.image;
        return (
          rendered.coloredPixels > 100 &&
          rendered.visiblePixels > 1000 &&
          (expectedImage === undefined || image === expectedImage)
        );
      },
      { message: 'Expected saved segmentation pixels and source framing' }
    )
    .toBe(true);
  return image;
}

async function releaseMaskAfterReachableProjection(
  page: Page,
  oct: OctUtils,
  inspected: Inspected
) {
  try {
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as MaskGateWindow).maskRestoreGate.entered
        )
      )
      .toBe(true);
    await expect(
      page.locator(VIEWER + ' .annotation-cell').first()
    ).toContainText(SOURCE_NAME);
    await expectCameraAndPixels(oct, inspected);
    await expect
      .poll(
        async () => (await canvasAppearance(sourceCanvas(page))).visiblePixels
      )
      .toBeGreaterThan(1000);
    expect((await canvasAppearance(sourceCanvas(page))).coloredPixels).toBe(0);
    await page.evaluate(() => {
      const gate = (window as unknown as MaskGateWindow).maskRestoreGate;
      if (!gate.release) throw new Error('No decoded archived mask is held');
      gate.release();
    });
  } finally {
    await page.evaluate(() => {
      const gate = (window as unknown as MaskGateWindow).maskRestoreGate;
      gate.armed = false;
      gate.release?.();
    });
  }
}

test.describe('Projection camera persistence', () => {
  useReferenceLines();

  test.beforeEach(({ page }) => installMaskDecodeGate(page));

  for (const explicitReset of [false, true]) {
    test(
      'persists navigation with automatic reset disabled ' +
        (explicitReset ? 'after explicit Reset Views' : 'before any reset'),
      async ({ page, volview, utils, oct, scratch }) => {
        await stageCameraScene(utils);
        await openCameraScene(volview, true);
        const dialog = await volview.openSettings();
        const preference = dialog.locator('label', {
          hasText: containsText('Camera Auto Reset'),
        });
        await preference.click();
        await expect(preference.locator('..').locator('input')).toBeChecked();
        await volview.closeSettings();
        await expect(preference).toBeHidden();
        await utils.openThroughDialog(scratch.path(STEM + '/' + SOURCE_NAME));
        await oct.waitForEnFaceReady();
        if (explicitReset)
          await page
            .locator('button[data-testid="control-button-Reset Views"]')
            .click();
        const inspected = await panAndZoom(page, oct);
        await sourceCanvas(page).dblclick();
        await expect(page.locator(CANVAS)).not.toBeAttached();
        await waitForTransitions(sourceCanvas(page));
        await sourceCanvas(page).dblclick();
        await expectCameraAndPixels(oct, inspected);
        const saved = await volview.saveSession();
        await volview.open('?urls=[tmp/' + saved + ']');
        await expectCameraAndPixels(oct, inspected);
        expect(await volview.getNotificationsCount()).toBe(0);
      }
    );
  }

  test('restores a nondefault-axis camera after the archived mask finishes decoding', async ({
    page,
    volview,
    utils,
    oct,
    scratch,
  }) => {
    await stageCameraScene(utils);
    await openCameraScene(volview);
    await oct.waitForEnFaceReady();
    await oct.openEnFaceProjection();
    await oct.selectSetting('enface-projection-axis', 'Sagittal');
    await oct.setSlabRange(10, 100);
    await oct.waitForEnFaceReady();
    // Captured before the mask exists, as the restore shows it while decoding.
    const baseProjection = await panAndZoom(page, oct);
    await oct.attachAndSelectMask(STEM + '/' + MASK_NAME, SEGMENT_NAME);
    await oct.openEnFaceControls();
    await oct.setSegmentThreshold(SEGMENT_NAME, 6500);
    await oct.expectHighlight(true);
    await oct.expectProjectionTransform(baseProjection.transform);
    const inspected = {
      transform: baseProjection.transform,
      image: (await oct.enFaceAppearance()).image,
    };
    const sourceMaskImage = await expectSourceMaskPixels(page);
    const saved = await volview.saveSession();

    await volview.open();
    await page.evaluate(() => {
      (window as unknown as MaskGateWindow).maskRestoreGate.armed = true;
    });
    await utils.openThroughDialog(scratch.path(saved));
    await releaseMaskAfterReachableProjection(page, oct, baseProjection);
    await expectSourceMaskPixels(page, sourceMaskImage);
    await expectCameraAndPixels(oct, inspected);
    await oct.openEnFaceControls();
    await oct.expectEnFaceProjectionSettings('Sagittal', 10, 100);
    await oct.expandEnFaceSection('segments');
    await expect(oct.segmentEye(SEGMENT_NAME)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(oct.segmentThreshold(SEGMENT_NAME)).toHaveValue('6500');
    await oct.expectHighlight(true);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
