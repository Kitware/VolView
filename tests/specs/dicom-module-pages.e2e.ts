import { startDicomPages } from '../fixtures/dicom-pages/server.mjs';
import { openDicomPage } from '../dicomPages';

// Every stored 5 under slope 2 and intercept -20.
const CALIBRATED_PIXELS = Array(16).fill('-10').join(', ');

describe('DICOM decode worker without VolView startup', () => {
  let fixture: Awaited<ReturnType<typeof startDicomPages>>;
  before(async () => {
    fixture = await startDicomPages();
  });
  after(async () => fixture?.close());

  it('rejects a failed worker startup and finishes queued and later reads', async () => {
    await openDicomPage(fixture.urls.core);
    await expect($('#first-error')).toHaveText('DICOM decoder worker failed');
    await expect($('#queued-pixels')).toHaveText(CALIBRATED_PIXELS);
    await expect($('#retry-pixels')).toHaveText(CALIBRATED_PIXELS);
  });
});
