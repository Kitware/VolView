import { PNG } from 'pngjs';
import { resolve } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { fixtureBytes } from '../fixtures/dicom-consumer/fixtureData';
import { startDicomConsumerFixtures } from '../fixtures/dicom-consumer/server.mjs';

// Both pages consume emitted JavaScript; metadata workers and GDCM assets are
// served from the same standalone output, without VolView startup.
describe('Independent DICOM package consumers', () => {
  let fixture: Awaited<ReturnType<typeof startDicomConsumerFixtures>>;
  before(async () => {
    fixture = await startDicomConsumerFixtures(fixtureBytes());
  });
  after(async () => fixture?.close());

  for (const kind of ['core', 'vtk'] as const) {
    for (const source of ['file', 'http']) {
      it(`${kind} preserves metadata and calibrated pixels from ${source}`, async () => {
        await browser.url(`${fixture.urls[kind]}?source=${source}`);
        await browser.waitUntil(
          async () =>
            (await $('#status').isExisting()) ||
            (await $('#error').isExisting())
        );
        if (await $('#error').isExisting())
          throw new Error(await $('#error').getText());
        await expect($('#status')).toHaveText('complete');
        await expect($('#patient')).toHaveText('EXTRACTED^DICOM');
        await expect($('#position')).toHaveText('10, 20, 30');
        await expect($('#pixel-spacing')).toHaveText('2, 3');
        if (kind === 'core') {
          await expect($('#pixels')).toHaveText(
            Array(16).fill('-10').join(', ')
          );
        } else {
          await expect($('#spacing')).toHaveText('3, 2, 4');
          await expect($('#origin')).toHaveText('10, 20, 30');
          await expect($('#range')).toHaveText('-10, -10');
          const screenshot = PNG.sync.read(
            await $('#viewport').saveScreenshot(
              resolve(TEMP_DIR, `dicom-${source}.png`)
            )
          );
          const center =
            ((screenshot.height >> 1) * screenshot.width +
              (screenshot.width >> 1)) *
            4;
          expect(screenshot.data[center]).toBeGreaterThan(110);
          expect(screenshot.data[center]).toBeLessThan(145);
          expect(screenshot.data[0]).toBe(0);
        }
      });
    }
  }
});
