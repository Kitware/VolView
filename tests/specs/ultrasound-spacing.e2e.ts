import { US_MULTIFRAME_DICOM } from '../datasets';
import { test, expect } from '../fixtures';

// The exact ruler length depends on platform-specific viewport geometry, but
// the unspaced fallback is roughly twice as large because the DICOM fixture's
// PhysicalDeltaX/Y is 0.5104970559 mm/pixel.
const CLICK_DY = 100;
const MIN_SPACED_LENGTH_MM = 30;
const MAX_SPACED_LENGTH_MM = 80;

test.describe('Ultrasound image spacing', () => {
  test('ruler length reflects physical spacing from SequenceOfUltrasoundRegions', async ({
    page,
    volview,
    utils,
    segmentation,
  }) => {
    await utils.openUrls([US_MULTIFRAME_DICOM]);
    await volview.waitForViews();

    await page.locator('button span i[class~=mdi-ruler]').click();

    // Offsets are measured from the canvas center, as WebdriverIO's
    // element.click({ x, y }) measured them.
    const box = await page
      .locator('div[data-testid="vtk-view vtk-cine-view"] canvas')
      .first()
      .boundingBox();
    if (!box) throw new Error('The cine canvas is not on screen');
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.mouse.click(centerX, centerY - CLICK_DY / 2);
    await page.mouse.click(centerX, centerY + CLICK_DY / 2);

    await segmentation.openSegmentShapes();

    let lengthMm = 0;
    await expect
      .poll(
        async () => {
          const texts = await page
            .locator('[data-testid="segment-shape-row"]')
            .allInnerTexts();
          for (const text of texts) {
            const match = text.match(/([\d.]+)\s*mm/);
            if (match) {
              lengthMm = parseFloat(match[1]);
              return lengthMm > 0;
            }
          }
          return false;
        },
        { message: 'Ruler length (mm) not found in measurements sidebar' }
      )
      .toBe(true);

    console.log(`[ultrasound-spacing] measured ruler length: ${lengthMm} mm`);

    expect(lengthMm).toBeGreaterThan(MIN_SPACED_LENGTH_MM);
    expect(lengthMm).toBeLessThan(MAX_SPACED_LENGTH_MM);
  });
});
