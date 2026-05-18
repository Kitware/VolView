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
  it('reloads with the ruler hidden on frame 1 and visible on the placed frame', async () => {
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
    await waitForFrame(1);

    // Wait for the deserialized ruler to surface in the Measurements list
    // before asserting it's hidden on the canvas. Without this anchor a
    // regression that loses `frame` (ruler tagged frame 1 instead) could
    // race the assertion and pass for the wrong reason; the list entry
    // proves deserialization has completed.
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

    // On reload the cursor lives at frame 1 (playback frame is not
    // persisted). The ruler must be hidden here — if `frame` was lost
    // during serialize/deserialize, it would render at frame 1 instead.
    expect(await countCineRulerLines()).toBe(0);

    // Scrub forward to the placement frame and the ruler should reappear.
    await volViewPage.focusFirst2DView();
    while ((await getCineFrame())! < placementFrame) {
      await advanceCineFrame();
    }
    await browser.waitUntil(async () => (await countCineRulerLines()) >= 1, {
      timeoutMsg: `Expected the ruler to reappear at the placement frame (${placementFrame}) after reload`,
    });
  });
});
