import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createNrrdVolume } from '../fixtures/oct/volumes';
import { expectDisplayed } from '../pageobjects/volview.page';
import { VIEWER } from './octTestUtils';

const STEM = 'slab-reference-visibility';
const SOURCE = 'div[data-testid~="vtk-two-view"]';
async function expectReferenceLines(page: Page, visible: boolean) {
  const lines = [
    page
      .locator(VIEWER)
      .first()
      .locator('[data-testid="enface-slice-lines"] line')
      .first(),
    page
      .locator(SOURCE)
      .first()
      .locator('[data-testid="reference-lines"] line')
      .first(),
  ];
  for (const line of lines) {
    if (visible) await expectDisplayed(line);
    else await expect(line).not.toBeAttached();
  }
}

test.describe('Slab reference-line visibility', () => {
  test('shares the setting and Crosshairs override with source slices, including a hidden base image', async ({
    page,
    volview,
    utils,
    oct,
    referenceLines,
  }) => {
    fs.writeFileSync(
      path.join(utils.makeTempDir(STEM), 'source.nrrd'),
      createNrrdVolume({
        dimensions: [8, 7, 6],
        spacing: [1, 1, 1],
        scalars: Uint16Array.from({ length: 8 * 7 * 6 }, (_, index) => index),
      })
    );
    await utils.writeManifestToFile(
      { layouts: { Visibility: [['axial', 'coronal'], ['enface']] } },
      STEM + '.json'
    );
    await volview.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/source.nrrd]`);
    await oct.waitForEnFaceReady();
    await page.locator(VIEWER).first().locator('canvas').first().click();
    await oct.toolButton('Pan').click();
    await referenceLines.setReferenceLinesEnabled(false);
    await expectReferenceLines(page, false);

    await referenceLines.setReferenceLinesEnabled(true);
    await expectReferenceLines(page, true);

    await volview.renderingModuleTab.click();
    await utils.waitForModuleTransitions();
    await page.locator('[data-testid="base-image-visibility"]').click();
    await oct.waitForEnFaceReady();
    await expectReferenceLines(page, true);

    await referenceLines.setReferenceLinesEnabled(false);
    await expectReferenceLines(page, false);
    await page.locator(SOURCE).first().locator('canvas').first().click();
    await oct.toolButton('Crosshairs').click();
    await expectReferenceLines(page, true);
    await oct.toolButton('Pan').click();
    await expectReferenceLines(page, false);
  });
});
