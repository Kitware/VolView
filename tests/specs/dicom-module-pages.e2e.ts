import { PNG } from 'pngjs';
import { resolve } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { fixtureBytes } from '../fixtures/dicom-pages/fixtureData';
import { startDicomPages } from '../fixtures/dicom-pages/server.mjs';
import { openDicomPage } from '../dicomPages';

// Every stored 5 under slope 2 and intercept -20.
const CALIBRATED_PIXELS = Array(16).fill('-10').join(', ');

describe('DICOM module pages without VolView startup', () => {
  let fixture: Awaited<ReturnType<typeof startDicomPages>>;
  before(async () => {
    fixture = await startDicomPages({
      fixtures: { 'fixture.dcm': fixtureBytes() },
    });
  });
  after(async () => fixture?.close());

  it('rejects a failed worker startup and finishes queued and later reads', async () => {
    await openDicomPage(`${fixture.urls.core}?scenario=worker-recovery`);
    await expect($('#first-error')).toHaveText('DICOM decoder worker failed');
    await expect($('#queued-pixels')).toHaveText(CALIBRATED_PIXELS);
    await expect($('#retry-pixels')).toHaveText(CALIBRATED_PIXELS);
  });

  it('core reads metadata and calibrated pixels from a file', async () => {
    await openDicomPage(`${fixture.urls.core}?source=file`);
    await expect($('#patient')).toHaveText('EXTRACTED^DICOM');
    await expect($('#position')).toHaveText('10, 20, 30');
    await expect($('#pixel-spacing')).toHaveText('2, 3');
    await expect($('#pixels')).toHaveText(CALIBRATED_PIXELS);
  });

  it('vtk places and renders the volume read over HTTP', async () => {
    await openDicomPage(`${fixture.urls.vtk}?source=http`);
    await expect($('#patient')).toHaveText('EXTRACTED^DICOM');
    await expect($('#spacing')).toHaveText('3, 2, 4');
    await expect($('#origin')).toHaveText('10, 20, 30');
    await expect($('#range')).toHaveText('-10, -10');
    const screenshot = PNG.sync.read(
      await $('#viewport').saveScreenshot(resolve(TEMP_DIR, 'dicom-vtk.png'))
    );
    const center =
      ((screenshot.height >> 1) * screenshot.width + (screenshot.width >> 1)) *
      4;
    expect(screenshot.data[center]).toBeGreaterThan(110);
    expect(screenshot.data[center]).toBeLessThan(145);
    expect(screenshot.data[0]).toBe(0);
  });
});
