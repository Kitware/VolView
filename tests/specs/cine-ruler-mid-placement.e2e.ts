// A placing widget must reset when the cine frame cursor moves mid-placement.
// Otherwise the user can click the first point on frame N, scroll to frame M,
// click again, and commit a ruler whose two endpoints were drawn on different
// frames but whose tool.frame is M — silently wrong geometry.
//
// Distinguishing a *committed* ruler from a degenerate placing-tool point at
// click time is fragile (both render an svg <line>), so we scrub off the
// click frame and back. A committed (buggy) ruler persists; an unfinished
// placing tool is wiped by the reset on the second scroll.
import { test, expect } from '../fixtures';

test.describe('Cine placing widget resets on frame change', () => {
  test('does not commit a ruler whose clicks span two cine frames', async ({
    page,
    cine,
  }) => {
    const firstClickFrame = await cine.openCinePastFirstFrame();

    const rulerToolButton = page.locator('button span i[class~=mdi-ruler]');
    await rulerToolButton.click();

    const { cx, cy } = await cine.getCineCanvasCenter();
    await cine.clickAt(cx - 40, cy);

    await cine.advanceCineFrame();
    await cine.advanceCineFrame();
    const secondClickFrame = (await cine.getCineFrame())!;
    expect(secondClickFrame).not.toBe(firstClickFrame);

    await cine.clickAt(cx + 40, cy);

    // Scroll off the click frame and back. This wipes any unfinished
    // placement (which would render a degenerate <line>) and leaves only
    // *committed* rulers. A correctly-reset placement contributes nothing
    // here; a buggy cross-frame commit shows up as a 1-line ruler on the
    // click frame.
    await cine.advanceCineFrame();
    await cine.retreatCineFrame();
    expect(await cine.getCineFrame()).toBe(secondClickFrame);

    expect(await cine.countCineRulerLines()).toBe(0);
  });
});
