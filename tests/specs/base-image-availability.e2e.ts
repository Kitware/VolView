import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { exactText, type VolViewPage } from '../pageobjects/volview.page';
import { CINE_VIEW_SELECTOR } from './cineTestUtils';
import { buildSyntheticCineDicom, newUid } from './syntheticDicom';
import type { Utils } from './utils';

async function selectCineLayout(
  page: Page,
  volview: VolViewPage,
  name: string,
  count: number
) {
  await volview.layoutButton.click();
  await page
    .locator('.v-list-item-title', { hasText: exactText(name) })
    .click();
  await expect(page.locator(CINE_VIEW_SELECTOR)).toHaveCount(count);
}

async function expectCineVisibility(
  page: Page,
  utils: Utils,
  visible: boolean,
  count: number
) {
  await utils.moveToElement(page.locator('header'));
  await expect
    .poll(
      async () => {
        const views = await utils.captureViewPixels(
          CINE_VIEW_SELECTOR,
          80,
          'cine-base-visibility.png'
        );
        return (
          views.length === count &&
          views.every(({ data }) => {
            const bright = data.filter(
              (value, index) => index % 4 !== 3 && value > 40
            ).length;
            return visible ? bright > 1000 : bright < 1000;
          })
        );
      },
      {
        message: `Expected ${count} cine images to be ${visible ? 'visible' : 'hidden'}`,
      }
    )
    .toBe(true);
}

test.describe('Base image availability', () => {
  test('keeps cine visibility available in 3D Only and maximized 3D slots', async ({
    page,
    volview,
    utils,
  }) => {
    const directory = utils.makeTempDir('cine-base-visibility');
    writeFileSync(
      join(directory, 'cine.dcm'),
      buildSyntheticCineDicom({
        studyUid: newUid(),
        seriesUid: newUid(),
        sopUid: newUid(),
        rows: 16,
        cols: 16,
        numberOfFrames: 3,
      })
    );
    await utils.openVolViewPage('cine-base-visibility/cine.dcm');
    await selectCineLayout(page, volview, 'Four Up', 4);
    await volview.renderingModuleTab.click();
    await utils.waitForModuleTransitions();
    const visibility = page.locator('[data-testid="base-image-visibility"]');
    await visibility.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await expect(visibility).toBeEnabled();
    await expectCineVisibility(page, utils, true, 4);
    await visibility.click();
    await expect(visibility).toContainText('SHOW', { useInnerText: true });
    await expectCineVisibility(page, utils, false, 4);

    await selectCineLayout(page, volview, '3D Only', 1);
    await expect(visibility).toContainText('SHOW', { useInnerText: true });
    await expect(visibility).toBeEnabled();
    await expect(
      page.locator('[data-testid="base-image-range-min"] input')
    ).toBeDisabled();
    await expect(
      page.locator('[data-testid="base-image-contrast"]')
    ).toBeDisabled();
    await expectCineVisibility(page, utils, false, 1);
    await visibility.click();
    await expect(visibility).toContainText('HIDE', { useInnerText: true });
    await expectCineVisibility(page, utils, true, 1);

    await selectCineLayout(page, volview, 'Four Up', 4);
    await visibility.click();
    await expect(visibility).toContainText('SHOW', { useInnerText: true });
    await page.locator(CINE_VIEW_SELECTOR).nth(3).dblclick();
    await expect(page.locator(CINE_VIEW_SELECTOR)).toHaveCount(1);
    await expect(visibility).toBeEnabled();
    await expectCineVisibility(page, utils, false, 1);
    await visibility.click();
    await expectCineVisibility(page, utils, true, 1);
  });
});
