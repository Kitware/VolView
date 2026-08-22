// A DICOM series whose instances disagree on Rows/Columns still groups into a
// single volume, and that volume's buffer is sized from the first instance.
// An instance that does not fit has to be rejected with a message naming it,
// whether it is too big for its slot or too small to fill one, and the rest of
// the series has to reach a usable state anyway.
import * as path from 'path';
import * as fs from 'fs';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import { writeManifestToFile } from './utils';

const IMAGE_ORIENTATION_PATIENT = [1, 0, 0, 0, 1, 0] as const;
const SLICE_COUNT = 5;
const MIDDLE_SLICE = 2;

const SMALL_ROWS = 4;
const SMALL_COLS = 6;
const BIG_ROWS = 8;
const BIG_COLS = 10;

type Size = { rows: number; cols: number };

async function writeSeries(
  dirName: string,
  series: Size,
  outlier: Size,
  outlierSlice: number,
  manifestName: string
) {
  const dir = path.join(TEMP_DIR, dirName);
  fs.mkdirSync(dir, { recursive: true });
  cleanuptotal.addCleanup(async () => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const studyUid = newUid();
  const seriesUid = newUid();
  const resources = [];
  let outlierSopUid = '';

  for (let i = 0; i < SLICE_COUNT; i++) {
    const mismatched = i === outlierSlice;
    const sopUid = newUid();
    if (mismatched) outlierSopUid = sopUid;

    const { rows, cols } = mismatched ? outlier : series;
    const filename = `slice-${i}.dcm`;
    fs.writeFileSync(
      path.join(dir, filename),
      buildSyntheticDicom({
        studyUid,
        seriesUid,
        sopUid,
        instanceNumber: i + 1,
        imageOrientationPatient: IMAGE_ORIENTATION_PATIENT,
        imagePositionPatient: [0, 0, i],
        rows,
        cols,
      })
    );
    resources.push({ url: `tmp/${dirName}/${filename}`, name: filename });
  }

  await writeManifestToFile({ resources }, manifestName);

  return outlierSopUid;
}

// The slice count in the "Slice: n/total" overlay of the first 2D view.
async function getRenderedSliceCount() {
  return browser.execute((selector: string) => {
    const view = document.querySelector(selector);
    const match = view?.textContent?.match(/Slice:\s*\d+\s*\/\s*(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }, 'div[data-testid~="vtk-two-view"]');
}

// A rejected chunk is terminal, so the views stop advertising progress even
// though part of the series never arrived.
async function waitForSeriesToSettle() {
  await volViewPage.waitForViews();
  await browser.waitUntil(
    async () => (await getRenderedSliceCount()) === SLICE_COUNT,
    {
      timeout: 30000,
      timeoutMsg: `expected the 2D view to show a ${SLICE_COUNT} slice volume`,
    }
  );
  await browser.waitUntil(
    async () => (await $$('.loading-indicator').length) === 0,
    {
      timeout: 30000,
      timeoutMsg: 'expected the views to stop showing a loading indicator',
    }
  );
}

// The badge only says "at least one error so far", so a count read as soon as
// it appears can miss a failure still on its way. Wait for it to hold steady.
async function waitForNotificationCountToSettle() {
  let previous = await volViewPage.getNotificationsCount();
  await browser.waitUntil(
    async () => {
      await browser.pause(500);
      const current = await volViewPage.getNotificationsCount();
      const held = current === previous;
      previous = current;
      return held;
    },
    {
      timeout: 30000,
      timeoutMsg: 'expected the notification count to stop changing',
    }
  );
  return previous;
}

async function readErrorDetails() {
  await volViewPage.notifications.click();

  const errorPanel = $('.message-center .v-expansion-panel-title');
  await errorPanel.waitForClickable();
  await errorPanel.click();

  const details = $('.message-center pre.details');
  await details.waitForDisplayed();
  // The panel animates open, so the text arrives a frame after the element.
  await browser.waitUntil(async () => (await details.getText()).length > 0, {
    timeout: 5000,
    timeoutMsg: 'expected the error details to render',
  });
  return details.getText();
}

async function loadAndReadRejection(manifestName: string) {
  await volViewPage.open(`?urls=[tmp/${manifestName}]`);
  await volViewPage.waitForNotification();
  await waitForSeriesToSettle();
  const errorCount = await waitForNotificationCountToSettle();
  const text = await readErrorDetails();
  return { text, errorCount };
}

describe('DICOM series with an instance of a different size', () => {
  it('names the offending file when it overruns its slot', async () => {
    const manifestName = `dimension-mismatch-big-${Date.now()}.json`;
    const outlierSopUid = await writeSeries(
      'dimension-mismatch-big',
      { rows: SMALL_ROWS, cols: SMALL_COLS },
      { rows: BIG_ROWS, cols: BIG_COLS },
      MIDDLE_SLICE,
      manifestName
    );

    const { text, errorCount } = await loadAndReadRejection(manifestName);

    expect(text).toContain(outlierSopUid);
    expect(text).toContain(`${BIG_COLS}x${BIG_ROWS}x1`);
    expect(text).toContain(`${SMALL_COLS}x${SMALL_ROWS}x1`);
    expect(text).toContain('Rows, Columns, and SamplesPerPixel');

    // Only the instance that does not fit is rejected; the rest of the series
    // still loads, so there is exactly one error to report.
    expect(errorCount).toBe(1);
  });

  // An under-sized instance fits inside its slot, so the write itself cannot
  // detect it; only the metadata comparison can.
  it('names the offending file when it underfills its slot', async () => {
    const manifestName = `dimension-mismatch-small-${Date.now()}.json`;
    const outlierSopUid = await writeSeries(
      'dimension-mismatch-small',
      { rows: BIG_ROWS, cols: BIG_COLS },
      { rows: SMALL_ROWS, cols: SMALL_COLS },
      MIDDLE_SLICE,
      manifestName
    );

    const { text, errorCount } = await loadAndReadRejection(manifestName);

    expect(text).toContain(outlierSopUid);
    expect(text).toContain(`${SMALL_COLS}x${SMALL_ROWS}x1`);
    expect(text).toContain(`${BIG_COLS}x${BIG_ROWS}x1`);
    expect(errorCount).toBe(1);
  });

  // Both axes differing would still be caught if either half of the comparison
  // were dropped; a single differing axis pins down both halves.
  it('rejects an instance that differs on rows alone', async () => {
    const manifestName = `dimension-mismatch-rows-${Date.now()}.json`;
    const outlierSopUid = await writeSeries(
      'dimension-mismatch-rows',
      { rows: SMALL_ROWS, cols: SMALL_COLS },
      { rows: BIG_ROWS, cols: SMALL_COLS },
      MIDDLE_SLICE,
      manifestName
    );

    const { text, errorCount } = await loadAndReadRejection(manifestName);

    expect(text).toContain(outlierSopUid);
    expect(text).toContain(`${SMALL_COLS}x${BIG_ROWS}x1`);
    expect(text).toContain(`${SMALL_COLS}x${SMALL_ROWS}x1`);
    expect(errorCount).toBe(1);
  });

  // The volume is sized from the first instance, so an outlier there rejects
  // every other chunk, one error apiece. Collapsing them into a single
  // notification belongs with the error-boundary work in issue 911.
  it('rejects the rest of the series when the first instance is the outlier', async () => {
    const manifestName = `dimension-mismatch-first-${Date.now()}.json`;
    const outlierSopUid = await writeSeries(
      'dimension-mismatch-first',
      { rows: SMALL_ROWS, cols: SMALL_COLS },
      { rows: BIG_ROWS, cols: BIG_COLS },
      0,
      manifestName
    );

    const { text, errorCount } = await loadAndReadRejection(manifestName);

    expect(errorCount).toBe(SLICE_COUNT - 1);
    // The first instance defines the volume, so it is the other four that are
    // named as not fitting.
    expect(text).not.toContain(outlierSopUid);
    expect(text).toContain('does not fit the volume it belongs to');
    expect(text).toContain(`${SMALL_COLS}x${SMALL_ROWS}x1`);
    expect(text).toContain(`${BIG_COLS}x${BIG_ROWS}x1`);
  });
});
