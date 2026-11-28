import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, useReferenceLines } from '../fixtures';
import { createSyntheticOCT } from '../fixtures/oct/dicom';
import {
  setValueVueInput,
  waitForTransitions,
} from '../pageobjects/volview.page';
import type { Utils } from './utils';
import {
  canvasAppearance,
  displayedWindow,
  CANVAS,
  VIEWER,
  WINDOW_TOOL,
} from './octTestUtils';

const SOURCE = 'div[data-testid~="vtk-two-view"]';

const fingerprint = (page: Page, selector: string) =>
  canvasAppearance(page.locator(selector).first());

async function selectView(utils: Utils, label: string, view: Locator) {
  await view.locator('.view-type-select .v-field').click();
  await utils.overlayOption(label).click();
}

test.describe('Projection lifecycle', () => {
  useReferenceLines();

  test('shows the latest method and slab, preserves source peers, and remounts current settings', async ({
    page,
    volview,
    utils,
    oct,
    octInteraction,
  }) => {
    const directory = utils.makeTempDir('projection-lifecycle');
    fs.writeFileSync(path.join(directory, 'retina.dcm'), createSyntheticOCT());
    await utils.writeManifestToFile(
      { layouts: { 'Projection lifecycle': [['axial'], ['enface']] } },
      'projection-lifecycle.json'
    );
    await volview.open(
      '?urls=[tmp/projection-lifecycle.json,tmp/projection-lifecycle/retina.dcm]'
    );
    await volview.waitForViews();
    await oct.waitForEnFaceReady();
    await expect
      .poll(
        async () => (await fingerprint(page, SOURCE + ' canvas')).visiblePixels
      )
      .toBeGreaterThan(100);
    const sourcePixels = await fingerprint(page, SOURCE + ' canvas');
    const sourceWindow = await displayedWindow(page.locator(SOURCE).first());

    await page.locator(CANVAS).click();
    await page.locator(WINDOW_TOOL).click();
    const inputs = page.locator('.v-overlay--active .manual-inputs input');
    await expect(inputs.nth(0)).toBeVisible();
    await waitForTransitions(inputs.nth(0));
    // The active class leaves as the menu closes, so follow the field out.
    const firstInput = await inputs.nth(0).elementHandle();
    await setValueVueInput(inputs.nth(0), '1000');
    await setValueVueInput(inputs.nth(1), '500');
    await page.keyboard.press('Escape');
    await firstInput?.waitForElementState('hidden');
    await octInteraction.expectProjectionPixel(81);
    const geometry = await oct.projectionTransform();

    for (const method of ['Maximum', 'Sum', 'Mean', 'Maximum', 'Mean'])
      await oct.chooseEnFaceProjection('enface-projection-method', method);
    await oct.waitForEnFaceReady();
    expect(await oct.getEnFaceWindow()).toEqual({ width: 192, level: 331 });
    await octInteraction.expectProjectionPixel(109);
    await oct.setEnFaceWindow(1000, 500);
    await oct.openEnFaceProjection();
    for (const [first, last] of [
      [10, 50],
      [100, 103],
      [100, 100],
    ])
      await oct.setSlabRange(first, last);
    await page.keyboard.press('Escape');
    await oct.waitForEnFaceReady();
    await octInteraction.expectProjectionPixel(75);
    expect(await oct.projectionTransform()).toEqual(geometry);
    expect(await displayedWindow(page.locator(SOURCE).first())).toEqual(
      sourceWindow
    );
    expect(await fingerprint(page, SOURCE + ' canvas')).toEqual(sourcePixels);

    const sourceCanvas = () => page.locator(SOURCE + ' canvas').first();
    await sourceCanvas().dblclick();
    await expect(page.locator(VIEWER)).not.toBeAttached();
    await waitForTransitions(sourceCanvas());
    await sourceCanvas().dblclick();
    await oct.waitForEnFaceReady();
    await octInteraction.expectProjectionPixel(75);
    expect(await oct.projectionTransform()).toEqual(geometry);

    await selectView(utils, 'Axial', page.locator(VIEWER).first());
    await expect(page.locator(VIEWER)).not.toBeAttached();
    await selectView(utils, 'En face', page.locator(SOURCE).nth(1));
    await oct.waitForEnFaceReady();
    await oct.setEnFaceWindow(1000, 500);
    await octInteraction.expectProjectionPixel(81);
    expect(await displayedWindow(page.locator(SOURCE).first())).toEqual(
      sourceWindow
    );
    expect(await fingerprint(page, SOURCE + ' canvas')).toEqual(sourcePixels);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
