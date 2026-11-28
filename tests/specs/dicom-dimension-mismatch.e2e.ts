// A DICOM series whose instances disagree on Rows/Columns still groups into a
// single volume, and that volume's buffer is sized from the first instance.
// An instance that does not fit has to be rejected with a message naming it,
// whether it is too big for its slot or too small to fill one, and the rest of
// the series has to reach a usable state anyway.
import * as path from 'path';
import * as fs from 'fs';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import type { Utils } from './utils';

const IMAGE_ORIENTATION_PATIENT = [1, 0, 0, 0, 1, 0] as const;
const SLICE_COUNT = 5;
const MIDDLE_SLICE = 2;

const SMALL_ROWS = 4;
const SMALL_COLS = 6;
const BIG_ROWS = 8;
const BIG_COLS = 10;

type Size = { rows: number; cols: number };
type Layout = { series: Size; outlier: Size; outlierSlice: number };

async function writeSeries(
  utils: Utils,
  dirName: string,
  { series, outlier, outlierSlice }: Layout,
  manifestName: string
) {
  const dir = utils.makeTempDir(dirName);

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

  await utils.writeManifestToFile({ resources }, manifestName);

  return outlierSopUid;
}

// The slice count in the "Slice: n/total" overlay of the first 2D view.
async function getRenderedSliceCount(page: Page) {
  return page.evaluate((selector: string) => {
    const view = document.querySelector(selector);
    const match = view?.textContent?.match(/Slice:\s*\d+\s*\/\s*(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }, 'div[data-testid~="vtk-two-view"]');
}

// A rejected chunk is terminal, so the views stop advertising progress even
// though part of the series never arrived.
async function waitForSeriesToSettle(page: Page, volview: VolViewPage) {
  await volview.waitForViews();
  await expect
    .poll(() => getRenderedSliceCount(page), {
      message: `expected the 2D view to show a ${SLICE_COUNT} slice volume`,
    })
    .toBe(SLICE_COUNT);
  await expect(
    page.locator('.loading-indicator'),
    'expected the views to stop showing a loading indicator'
  ).toHaveCount(0);
}

async function readErrorDetails(page: Page, volview: VolViewPage) {
  await volview.notifications.click();

  await page
    .locator('.message-center .v-expansion-panel-title')
    .first()
    .click();

  const details = page.locator('.message-center pre.details').first();
  await expect(details).toBeVisible();
  // The panel animates open, so the text arrives a frame after the element.
  await expect
    .poll(async () => (await details.innerText()).length, {
      message: 'expected the error details to render',
    })
    .toBeGreaterThan(0);
  return details.innerText();
}

async function loadAndReadRejection(
  page: Page,
  volview: VolViewPage,
  manifestName: string
) {
  await volview.open(`?urls=[tmp/${manifestName}]`);
  await volview.waitForNotification();
  await waitForSeriesToSettle(page, volview);
  const errorCount = await volview.getNotificationsCount();
  const text = await readErrorDetails(page, volview);
  return { text, errorCount };
}

test.describe('DICOM series with an instance of a different size', () => {
  test('names the offending file when it overruns its slot', async ({
    page,
    volview,
    utils,
  }) => {
    const manifestName = `dimension-mismatch-big-${Date.now()}.json`;
    const outlierSopUid = await writeSeries(
      utils,
      'dimension-mismatch-big',
      {
        series: { rows: SMALL_ROWS, cols: SMALL_COLS },
        outlier: { rows: BIG_ROWS, cols: BIG_COLS },
        outlierSlice: MIDDLE_SLICE,
      },
      manifestName
    );

    const { text, errorCount } = await loadAndReadRejection(
      page,
      volview,
      manifestName
    );

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
  test('names the offending file when it underfills its slot', async ({
    page,
    volview,
    utils,
  }) => {
    const manifestName = `dimension-mismatch-small-${Date.now()}.json`;
    const outlierSopUid = await writeSeries(
      utils,
      'dimension-mismatch-small',
      {
        series: { rows: BIG_ROWS, cols: BIG_COLS },
        outlier: { rows: SMALL_ROWS, cols: SMALL_COLS },
        outlierSlice: MIDDLE_SLICE,
      },
      manifestName
    );

    const { text, errorCount } = await loadAndReadRejection(
      page,
      volview,
      manifestName
    );

    expect(text).toContain(outlierSopUid);
    expect(text).toContain(`${SMALL_COLS}x${SMALL_ROWS}x1`);
    expect(text).toContain(`${BIG_COLS}x${BIG_ROWS}x1`);
    expect(errorCount).toBe(1);
  });

  // Both axes differing would still be caught if either half of the comparison
  // were dropped; a single differing axis pins down both halves.
  test('rejects an instance that differs on rows alone', async ({
    page,
    volview,
    utils,
  }) => {
    const manifestName = `dimension-mismatch-rows-${Date.now()}.json`;
    const outlierSopUid = await writeSeries(
      utils,
      'dimension-mismatch-rows',
      {
        series: { rows: SMALL_ROWS, cols: SMALL_COLS },
        outlier: { rows: BIG_ROWS, cols: SMALL_COLS },
        outlierSlice: MIDDLE_SLICE,
      },
      manifestName
    );

    const { text, errorCount } = await loadAndReadRejection(
      page,
      volview,
      manifestName
    );

    expect(text).toContain(outlierSopUid);
    expect(text).toContain(`${SMALL_COLS}x${BIG_ROWS}x1`);
    expect(text).toContain(`${SMALL_COLS}x${SMALL_ROWS}x1`);
    expect(errorCount).toBe(1);
  });

  // The volume is sized from the first instance, so an outlier there rejects
  // every other chunk, one error apiece. Collapsing them into a single
  // notification belongs with the error-boundary work in issue 911.
  test('rejects the rest of the series when the first instance is the outlier', async ({
    page,
    volview,
    utils,
  }) => {
    const manifestName = `dimension-mismatch-first-${Date.now()}.json`;
    const outlierSopUid = await writeSeries(
      utils,
      'dimension-mismatch-first',
      {
        series: { rows: SMALL_ROWS, cols: SMALL_COLS },
        outlier: { rows: BIG_ROWS, cols: BIG_COLS },
        outlierSlice: 0,
      },
      manifestName
    );

    const { text, errorCount } = await loadAndReadRejection(
      page,
      volview,
      manifestName
    );

    expect(errorCount).toBe(SLICE_COUNT - 1);
    // The first instance defines the volume, so it is the other four that are
    // named as not fitting.
    expect(text).not.toContain(outlierSopUid);
    expect(text).toContain('does not fit the volume it belongs to');
    expect(text).toContain(`${SMALL_COLS}x${SMALL_ROWS}x1`);
    expect(text).toContain(`${BIG_COLS}x${BIG_ROWS}x1`);
  });
});
