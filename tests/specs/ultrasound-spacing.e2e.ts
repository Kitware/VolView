import { US_MULTIFRAME_DICOM } from './configTestUtils';
import { openUrls } from './utils';
import { volViewPage } from '../pageobjects/volview.page';

const clickAt = async (x: number, y: number) => {
  await browser
    .action('pointer')
    .move({ x: Math.round(x), y: Math.round(y) })
    .down()
    .up()
    .perform();
};

// Offset between the two ruler clicks (in canvas pixels).
// The measured ruler length in mm depends on this offset, the canvas size,
// and the image spacing. With the US spacing fix the VTK spacing comes from
// SequenceOfUltrasoundRegions (~0.5105 mm); without the fix it falls back to
// 1.0 mm, which makes the measured length ~1.96x larger.
const CLICK_DX = 0;
const CLICK_DY = 100;

// Calibrated length (mm) that the ruler reports when the US spacing fix is
// active. Obtained by running this test once with the fix enabled.
// Without the fix the VTK spacing falls back to 1.0 mm/pixel, which makes
// the measured length grow to ~97 mm (~1.96x) and this assertion fails.
const EXPECTED_LENGTH_MM = 49.35;
const LENGTH_TOLERANCE_MM = 1.5;

describe('Ultrasound image spacing', () => {
  it('ruler length reflects physical spacing from SequenceOfUltrasoundRegions', async () => {
    await openUrls([US_MULTIFRAME_DICOM]);

    // Activate the ruler tool
    const rulerBtn = await $('button span i[class~=mdi-ruler]');
    await rulerBtn.waitForClickable();
    await rulerBtn.click();

    // Place the ruler on the first view's canvas
    const views = await volViewPage.views;
    const canvas = views[0];
    const loc = await canvas.getLocation();
    const size = await canvas.getSize();
    const cx = loc.x + size.width / 2;
    const cy = loc.y + size.height / 2;

    await clickAt(cx - CLICK_DX / 2, cy - CLICK_DY / 2);
    await clickAt(cx + CLICK_DX / 2, cy + CLICK_DY / 2);

    // Open Annotations > Measurements to read the ruler length
    const annotationsTab = await $(
      'button[data-testid="module-tab-Annotations"]'
    );
    await annotationsTab.click();

    const measurementsTab = await $('button.v-tab*=Measurements');
    await measurementsTab.waitForClickable();
    await measurementsTab.click();

    // The ruler details panel renders `{value}mm`; read the first length.
    let lengthMm = 0;
    await browser.waitUntil(
      async () => {
        const spans = await $$('.v-list-item .value');
        for (const span of spans) {
          const text = await span.getText();
          const match = text.match(/([\d.]+)\s*mm/);
          if (match) {
            lengthMm = parseFloat(match[1]);
            return lengthMm > 0;
          }
        }
        return false;
      },
      {
        timeout: 10_000,
        timeoutMsg: 'Ruler length (mm) not found in measurements sidebar',
      }
    );

    console.log(`[ultrasound-spacing] measured ruler length: ${lengthMm} mm`);

    if (EXPECTED_LENGTH_MM > 0) {
      expect(lengthMm).toBeGreaterThan(
        EXPECTED_LENGTH_MM - LENGTH_TOLERANCE_MM
      );
      expect(lengthMm).toBeLessThan(EXPECTED_LENGTH_MM + LENGTH_TOLERANCE_MM);
    } else {
      // Calibration mode: any positive value passes, actual number is logged.
      expect(lengthMm).toBeGreaterThan(0);
    }
  });
});
