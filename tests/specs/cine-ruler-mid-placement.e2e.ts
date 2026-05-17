// A placing widget must reset when the cine frame cursor moves mid-placement.
// Otherwise the user can click the first point on frame N, scroll to frame M,
// click again, and commit a ruler whose two endpoints were drawn on different
// frames but whose tool.frame is M — silently wrong geometry.
//
// Distinguishing a *committed* ruler from a degenerate placing-tool point at
// click time is fragile (both render an svg <line>), so we scrub off the
// click frame and back. A committed (buggy) ruler persists; an unfinished
// placing tool is wiped by the reset on the second scroll.
import { CINE_US_DATASET } from './configTestUtils';
import { openUrls } from './utils';
import { volViewPage } from '../pageobjects/volview.page';
import {
  advanceCineFrame,
  clickAt,
  countCineRulerLines,
  getCineCanvasCenter,
  getCineFrame,
  retreatCineFrame,
  waitForFrame,
} from './cineTestUtils';

describe('Cine placing widget resets on frame change', () => {
  it('does not commit a ruler whose clicks span two cine frames', async () => {
    await openUrls([CINE_US_DATASET]);
    await $('.play-controls').waitForDisplayed();
    await waitForFrame(1);

    await volViewPage.focusFirst2DView();
    await advanceCineFrame();
    await advanceCineFrame();
    const firstClickFrame = (await getCineFrame())!;
    expect(firstClickFrame).toBeGreaterThan(1);

    const rulerToolButton = await $('button span i[class~=mdi-ruler]');
    await rulerToolButton.click();

    const { cx, cy } = await getCineCanvasCenter();
    await clickAt(cx - 40, cy);

    await advanceCineFrame();
    await advanceCineFrame();
    const secondClickFrame = (await getCineFrame())!;
    expect(secondClickFrame).not.toBe(firstClickFrame);

    await clickAt(cx + 40, cy);

    // Scroll off the click frame and back. This wipes any unfinished
    // placement (which would render a degenerate <line>) and leaves only
    // *committed* rulers. A correctly-reset placement contributes nothing
    // here; a buggy cross-frame commit shows up as a 1-line ruler on the
    // click frame.
    await advanceCineFrame();
    await retreatCineFrame();
    expect(await getCineFrame()).toBe(secondClickFrame);

    expect(await countCineRulerLines()).toBe(0);
  });
});
