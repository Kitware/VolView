import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { volViewPage } from '../pageobjects/volview.page';
import { CINE_VIEW_SELECTOR } from './cineTestUtils';
import { buildSyntheticCineDicom, newUid } from './syntheticDicom';
import {
  captureViewPixels,
  makeTempDir,
  openVolViewPage,
  waitForModuleTransitions,
} from './utils';

async function selectCineLayout(name: string, count: number) {
  await volViewPage.layoutButton.click();
  const option = $(`.v-list-item-title=${name}`);
  await option.waitForClickable();
  await option.click();
  await expect($$(CINE_VIEW_SELECTOR)).toBeElementsArrayOfSize(count);
}

async function expectCineVisibility(visible: boolean, count: number) {
  await $('header').moveTo();
  await browser.waitUntil(
    async () => {
      const views = await captureViewPixels(
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
      timeoutMsg: `Expected ${count} cine images to be ${visible ? 'visible' : 'hidden'}`,
    }
  );
}

describe('Base image availability', () => {
  it('keeps cine visibility available in 3D Only and maximized 3D slots', async () => {
    const directory = makeTempDir('cine-base-visibility');
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
    await openVolViewPage('cine-base-visibility/cine.dcm');
    await selectCineLayout('Four Up', 4);
    await volViewPage.renderingModuleTab.click();
    await waitForModuleTransitions();
    const visibility = $('[data-testid="base-image-visibility"]');
    await visibility.scrollIntoView({ block: 'center', behavior: 'instant' });
    await expect(visibility).toBeEnabled();
    await expectCineVisibility(true, 4);
    await visibility.click();
    await expect(visibility).toHaveText(expect.stringContaining('SHOW'));
    await expectCineVisibility(false, 4);

    await selectCineLayout('3D Only', 1);
    await expect(visibility).toHaveText(expect.stringContaining('SHOW'));
    await expect(visibility).toBeEnabled();
    await expect(
      $('[data-testid="base-image-range-min"] input')
    ).toBeDisabled();
    await expect($('[data-testid="base-image-contrast"]')).toBeDisabled();
    await expectCineVisibility(false, 1);
    await visibility.click();
    await expect(visibility).toHaveText(expect.stringContaining('HIDE'));
    await expectCineVisibility(true, 1);

    await selectCineLayout('Four Up', 4);
    await visibility.click();
    await expect(visibility).toHaveText(expect.stringContaining('SHOW'));
    await $$(CINE_VIEW_SELECTOR)[3].doubleClick();
    await expect($$(CINE_VIEW_SELECTOR)).toBeElementsArrayOfSize(1);
    await expect(visibility).toBeEnabled();
    await expectCineVisibility(false, 1);
    await visibility.click();
    await expectCineVisibility(true, 1);
  });
});
