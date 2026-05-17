import { US_MULTIFRAME_DICOM } from './configTestUtils';
import { openUrls } from './utils';
import { volViewPage } from '../pageobjects/volview.page';

// The exact ruler length depends on platform-specific viewport geometry, but
// the unspaced fallback is roughly twice as large because the DICOM fixture's
// PhysicalDeltaX/Y is 0.5104970559 mm/pixel.
const CLICK_DY = 100;
const MIN_SPACED_LENGTH_MM = 30;
const MAX_SPACED_LENGTH_MM = 80;

describe('Ultrasound image spacing', () => {
  it('ruler length reflects physical spacing from SequenceOfUltrasoundRegions', async () => {
    await openUrls([US_MULTIFRAME_DICOM]);
    await volViewPage.waitForViews();

    const rulerBtn = await $('button span i[class~=mdi-ruler]');
    await rulerBtn.waitForClickable();
    await rulerBtn.click();

    // element.click({ x, y }) offsets are measured from the element's center,
    // so x:0 / y:0 is the canvas center.
    const canvas = await $('div[data-testid="vtk-view vtk-two-view"] canvas');

    await canvas.click({ x: 0, y: -CLICK_DY / 2 });
    await canvas.click({ x: 0, y: CLICK_DY / 2 });

    const annotationsTab = await volViewPage.annotationsModuleTab;
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

    expect(lengthMm).toBeGreaterThan(MIN_SPACED_LENGTH_MM);
    expect(lengthMm).toBeLessThan(MAX_SPACED_LENGTH_MM);
  });
});
