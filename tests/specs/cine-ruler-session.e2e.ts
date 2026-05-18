// Validates that the schema/serializer round-trips the cine annotation
// `frame` field: a ruler placed on cine frame N reloads visible only at
// frame N. A regression in either the zod schema or addTool defaults would
// silently lose the per-frame association.
import * as path from 'path';
import { CINE_US_DATASET } from './configTestUtils';
import { openUrls, SESSION_SAVE_TIMEOUT, waitForFileExists } from './utils';
import { volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import {
  advanceCineFrame,
  clickAt,
  countCineRulerLines,
  getCineCanvasCenter,
  getCineFrame,
  retreatCineFrame,
  waitForFrame,
} from './cineTestUtils';

const placeRulerAtCanvasCenter = async () => {
  const rulerToolButton = await $('button span i[class~=mdi-ruler]');
  await rulerToolButton.click();
  const { cx, cy } = await getCineCanvasCenter();
  await clickAt(cx - 40, cy);
  await clickAt(cx + 40, cy);
};

describe('Cine ruler survives save/reload at its placed frame', () => {
  it('reloads at the persisted frame with the ruler visible and hides it on frame 1', async () => {
    await openUrls([CINE_US_DATASET]);
    await $('.play-controls').waitForDisplayed();
    await waitForFrame(1);

    // Scrub to a non-default frame so a regression dropping `frame` would
    // pin the ruler to frame 0 — visually indistinguishable from "ruler
    // attached but tagged with the wrong frame".
    await volViewPage.focusFirst2DView();
    await advanceCineFrame();
    await advanceCineFrame();
    const placementFrame = (await getCineFrame())!;
    expect(placementFrame).toBeGreaterThan(1);

    await placeRulerAtCanvasCenter();
    await browser.waitUntil(async () => (await countCineRulerLines()) >= 1, {
      timeoutMsg: 'Expected the placed ruler line to render',
    });

    // Save → wait for the .zip on disk.
    const sessionFileName = await volViewPage.saveSession();
    await waitForFileExists(
      path.join(TEMP_DIR, sessionFileName),
      SESSION_SAVE_TIMEOUT
    );

    // Reload from the saved session — opens a fresh app state.
    await volViewPage.open(`?urls=[tmp/${sessionFileName}]`);
    await volViewPage.waitForViews();
    await $('.play-controls').waitForDisplayed({ timeout: 30000 });
    // The cine frame is persisted, so reload restores the cursor to
    // placementFrame rather than frame 1.
    await waitForFrame(placementFrame);

    // Wait for the deserialized ruler to surface in the Measurements list
    // before asserting visibility on the canvas. The list entry proves
    // deserialization has completed, so the subsequent canvas checks
    // can't race the load.
    const annotationsTab = await $(
      'button[data-testid="module-tab-Annotations"]'
    );
    await annotationsTab.click();
    const measurementsTab = await $('button.v-tab*=Measurements');
    await measurementsTab.waitForClickable();
    await measurementsTab.click();
    await browser.waitUntil(
      async () => (await $$('.v-list-item i.mdi-ruler.tool-icon').length) >= 1,
      {
        timeoutMsg:
          'Expected the deserialized ruler entry to appear in the list',
      }
    );

    // The ruler must be visible at the persisted placement frame — if
    // `frame` was lost during serialize/deserialize, it would still
    // render here, so we also need to verify it hides elsewhere.
    await browser.waitUntil(async () => (await countCineRulerLines()) >= 1, {
      timeoutMsg: `Expected the ruler to be visible at the persisted placement frame (${placementFrame}) after reload`,
    });

    // Scrub back to frame 1 — the ruler must hide there. A regression
    // that dropped `frame` would leave it visible on every frame.
    await volViewPage.focusFirst2DView();
    while ((await getCineFrame())! > 1) {
      await retreatCineFrame();
    }
    await browser.waitUntil(async () => (await countCineRulerLines()) === 0, {
      timeoutMsg: 'Expected the ruler to hide on frame 1 after reload',
    });
  });
});
