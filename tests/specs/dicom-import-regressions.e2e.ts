import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  waitForTransitions,
  type VolViewPage,
} from '../pageobjects/volview.page';
import type { Utils } from './utils';
import {
  buildSyntheticDicom,
  newUid,
  rawElement,
  sequenceItem,
  toImplicitVr,
  undefinedLengthUnknown,
} from './syntheticDicom';

const AXIAL = [1, 0, 0, 0, 1, 0] as const;

type Kit = { page: Page; volview: VolViewPage; utils: Utils };

// Exercise the local File import path, including metadata scanning and pixel
// decoding, through the same drop event a user produces.
async function dropSlices({ page, volview, utils }: Kit, files: Uint8Array[]) {
  const directory = utils.makeTempDir('import-regressions');
  const paths = files.map((bytes, i) => {
    const file = join(directory, `slice-${i}.dcm`);
    writeFileSync(file, bytes);
    return file;
  });
  await volview.open();
  await expect(page.locator('#app-container')).toBeAttached();
  await utils.dropFiles(paths);
}

async function probeCenter(page: Page, view: Locator, expected: number) {
  const box = await view.locator('canvas').boundingBox();
  if (!box) throw new Error('The view has no canvas on screen');
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.move(x + 1, y);
  await expect(
    page.locator('.probe-value-display .d-flex:first-child .text-right')
  ).toHaveText(String(expected));
}

async function axialView(page: Page, sliceCount: number) {
  const views = page.locator('[data-testid~="vtk-two-view"]');
  let found = -1;
  await expect
    .poll(
      async () => {
        const labels = await views.locator('.slice-label').allInnerTexts();
        found = labels.findIndex((label) =>
          label.trim().endsWith(`/${sliceCount}`)
        );
        return found;
      },
      { message: `Expected a view showing ${sliceCount} slices` }
    )
    .toBeGreaterThanOrEqual(0);
  return views.nth(found);
}

async function selectSlice(
  page: Page,
  view: Locator,
  index: number,
  count: number
) {
  const slider = view
    .locator('xpath=ancestor::div[contains(@class, "vtk-container-wrapper")]')
    .locator('.slice-slider');
  await waitForTransitions(slider);
  const [box, handle] = await Promise.all([
    slider.boundingBox(),
    slider.locator('.slice-slider-handle').boundingBox(),
  ]);
  if (!box || !handle) throw new Error('The slice slider is off screen');
  const y =
    box.y +
    handle.height / 2 +
    (box.height - handle.height) * (1 - index / (count - 1));
  await page.mouse.click(Math.round(box.x + box.width / 2), Math.round(y));
  await expect(view.locator('.slice-label')).toHaveText(
    `Slice: ${index + 1}/${count}`
  );
}

test.describe('Local DICOM import regressions', () => {
  test('loads every slice in order with slightly different slice orientations', async ({
    page,
    volview,
    utils,
  }) => {
    const studyUid = newUid();
    const seriesUid = newUid();
    const sopPrefix = newUid();
    const files = Array.from({ length: 121 }, (_, i) =>
      buildSyntheticDicom({
        studyUid,
        seriesUid,
        // The axial representative sorts before the tilted spatial first slice.
        sopUid: `${sopPrefix}.${i === 1 ? '1' : `2.${i}`}`,
        instanceNumber: i + 1,
        imageOrientationPatient:
          i === 0 ? [Math.cos(0.0002), 0, Math.sin(0.0002), 0, 1, 0] : AXIAL,
        imagePositionPatient: [0, 0, i * 5],
        pixelValue: i,
      })
    );

    await dropSlices({ page, volview, utils }, files);
    await volview.waitForVolumeCardSliceCounts([121]);
    await volview.waitForViews();
    await volview.waitForLoadingIndicator(
      page.locator('[data-testid~="vtk-two-view"]').first()
    );
    const view = await axialView(page, 121);
    for (const index of [0, 60, 120]) {
      await selectSlice(page, view, index, 121);
      await probeCenter(page, view, index);
    }
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('loads pixels from a file containing an undefined-length private UN sequence', async ({
    page,
    volview,
    utils,
  }) => {
    const content = toImplicitVr(
      rawElement(0x0043, 0x1030, 'LO', new TextEncoder().encode('VALUE '))
    );
    await dropSlices({ page, volview, utils }, [
      buildSyntheticDicom({
        studyUid: newUid(),
        seriesUid: newUid(),
        sopUid: newUid(),
        instanceNumber: 1,
        imageOrientationPatient: AXIAL,
        imagePositionPatient: [0, 0, 0],
        pixelValue: 123,
        extraElements: [
          rawElement(0x0043, 0x0010, 'LO', new TextEncoder().encode('TEST')),
          undefinedLengthUnknown(0x0043, 0x1029, sequenceItem(content)),
        ],
      }),
    ]);

    await volview.waitForVolumeCardSliceCounts([1]);
    await volview.waitForViews();
    await volview.waitForLoadingIndicator(
      page.locator('[data-testid~="vtk-two-view"]').first()
    );
    await probeCenter(page, await axialView(page, 1), 123);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('loads the rest of a series and reports once when one slice cannot be decoded', async ({
    page,
    volview,
    utils,
  }) => {
    const studyUid = newUid();
    const seriesUid = newUid();
    const files = Array.from({ length: 5 }, (_, i) =>
      buildSyntheticDicom({
        studyUid,
        seriesUid,
        sopUid: newUid(),
        instanceNumber: i + 1,
        imageOrientationPatient: AXIAL,
        imagePositionPatient: [0, 0, i],
        pixelValue: 10 * (i + 1),
      })
    );
    // 1.2.840.10008.1.2.9 is a transfer syntax no decoder reads.
    const syntax = Buffer.from(files[1]).indexOf('1.2.840.10008.1.2.1\0');
    files[1][syntax + 18] = '9'.charCodeAt(0);

    await dropSlices({ page, volview, utils }, files);
    await volview.waitForVolumeCardSliceCounts([5]);
    await volview.waitForNotification();
    await volview.waitForViews();
    await volview.waitForLoadingIndicator(
      page.locator('[data-testid~="vtk-two-view"]').first()
    );
    const view = await axialView(page, 5);
    for (const index of [0, 2, 4]) {
      await selectSlice(page, view, index, 5);
      await probeCenter(page, view, 10 * (index + 1));
    }
    const name = await page.locator('.volume-card .series-desc').innerText();
    expect(await volview.getNotificationTitles()).toEqual([
      `Error loading ${name}`,
    ]);
  });

  test('shows a color slice with no red as luminance in its thumbnail', async ({
    page,
    volview,
    utils,
  }) => {
    await dropSlices({ page, volview, utils }, [
      buildSyntheticDicom({
        studyUid: newUid(),
        seriesUid: newUid(),
        sopUid: newUid(),
        sopClassUid: '1.2.840.10008.5.1.4.1.1.7',
        modality: 'OT',
        instanceNumber: 1,
        imageOrientationPatient: AXIAL,
        imagePositionPatient: null,
        rows: 4,
        cols: 4,
        bitsAllocated: 8,
        rgbPixels: Array.from({ length: 4 }, () => [
          0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0,
        ]).flat(),
      }),
    ]);
    await volview.waitForVolumeCardSliceCounts([1]);
    const thumbnail = page.locator('.volume-card .thumbnail-container img');
    await expect(thumbnail).toHaveAttribute('src', /^data:image\/png;base64,/);
    const source = await thumbnail.getAttribute('src');
    if (!source) throw new Error('Expected a visible PNG thumbnail');
    const pixels = PNG.sync.read(Buffer.from(source.split(',')[1], 'base64'));
    expect(Array.from(pixels.data.slice(0, 12))).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 50, 50, 50, 255,
    ]);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
