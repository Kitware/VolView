import { US_MULTIFRAME_DICOM } from './configTestUtils';
import { openUrls } from './utils';
import { volViewPage } from '../pageobjects/volview.page';

// Vertical ruler in canvas pixels. The reported length in mm depends on
// canvas size, image-fit zoom, and the applied spacing. With the fix the
// VTK spacing comes from SequenceOfUltrasoundRegions (~0.5105 mm/image-px);
// without the fix it falls back to 1 mm/image-px and the ruler reports
// roughly 1.96× the with-fix value.
const CLICK_DY = 100;

// At the shared viewport (1200×800), with the fix active the ruler reports
// about 49 mm. Without the fix the same ruler reports about 97 mm. A wide
// tolerance lets the assertion absorb minor canvas-size jitter between
// runners while still excluding the 1 mm fallback.
const EXPECTED_LENGTH_MM = 49;
const LENGTH_TOLERANCE_MM = 8;

describe('Ultrasound image spacing', () => {
  it('ruler length reflects physical spacing from SequenceOfUltrasoundRegions', async () => {
    await openUrls([US_MULTIFRAME_DICOM]);
    await volViewPage.waitForViews();

    const rulerBtn = await $('button span i[class~=mdi-ruler]');
    await rulerBtn.waitForClickable();
    await rulerBtn.click();

    // element.click({ x, y }) offsets are measured from the element's center,
    // so x:0 / y:0 is the canvas center.
    const views = await volViewPage.views;
    const canvas = views[0];

    await canvas.click({ x: 0, y: -CLICK_DY / 2 });
    await canvas.click({ x: 0, y: CLICK_DY / 2 });

    const annotationsTab = await $(
      'button[data-testid="module-tab-Annotations"]'
    );
    await annotationsTab.click();

    const measurementsTab = await $('button.v-tab*=Measurements');
    await measurementsTab.waitForClickable();
    await measurementsTab.click();

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

    expect(lengthMm).toBeGreaterThan(EXPECTED_LENGTH_MM - LENGTH_TOLERANCE_MM);
    expect(lengthMm).toBeLessThan(EXPECTED_LENGTH_MM + LENGTH_TOLERANCE_MM);
  });
});
