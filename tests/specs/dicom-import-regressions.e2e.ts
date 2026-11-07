import { PNG } from 'pngjs';
import { volViewPage } from '../pageobjects/volview.page';
import {
  buildSyntheticDicom,
  newUid,
  rawElement,
  sequenceItem,
  toImplicitVr,
  undefinedLengthUnknown,
} from './syntheticDicom';

const AXIAL = [1, 0, 0, 0, 1, 0] as const;

// Exercise the local File import path, including metadata scanning and pixel
// decoding, through the same drop event a user produces.
async function dropFiles(files: Uint8Array[]) {
  await volViewPage.open();
  await $('#app-container').waitForExist();
  await browser.execute(
    (encodedFiles) => {
      const transfer = new DataTransfer();
      encodedFiles.forEach((encoded, i) => {
        const bytes = Uint8Array.from(atob(encoded), (char) =>
          char.charCodeAt(0)
        );
        transfer.items.add(new File([bytes], `slice-${i}.dcm`));
      });
      const event = new Event('drop', { bubbles: true, cancelable: true });
      // Synthetic items have no filesystem entries, so supply the files list.
      Object.defineProperty(event, 'dataTransfer', {
        value: { items: null, files: transfer.files },
      });
      document.querySelector('#app-container')!.dispatchEvent(event);
    },
    files.map((bytes) => Buffer.from(bytes).toString('base64'))
  );
}

async function probeCenter(view: WebdriverIO.Element, expected: number) {
  const canvas = view.$('canvas');
  await canvas.moveTo();
  await canvas.moveTo({ xOffset: 1, yOffset: 0 });
  await expect(
    $('.probe-value-display .d-flex:first-child .text-right')
  ).toHaveText(String(expected));
}

async function openSpacingDetails() {
  await $('.volume-card [data-testid="dataset-menu-button"]').click();
  const item = $('[data-testid="dataset-menu-spacing-item"]');
  await item.waitForStable();
  await item.waitForClickable();
  await item.click();
  await $('[data-testid="image-spacing-details"]').waitForDisplayed();
}

async function axialView(sliceCount: number) {
  return browser.waitUntil(async () => {
    const views = await $$('[data-testid~="vtk-two-view"]');
    for (const view of views) {
      const label = await view.$('.slice-label').getText();
      if (label.endsWith(`/${sliceCount}`)) return view;
    }
    return undefined;
  });
}

async function selectSlice(
  view: WebdriverIO.Element,
  index: number,
  count: number
) {
  const slider = view
    .$('./ancestor::div[contains(@class, "vtk-container-wrapper")]')
    .$('.slice-slider');
  const location = await slider.getLocation();
  const size = await slider.getSize();
  const handleSize = await slider.$('.slice-slider-handle').getSize();
  const y =
    location.y +
    handleSize.height / 2 +
    (size.height - handleSize.height) * (1 - index / (count - 1));
  await browser
    .action('pointer')
    .move({ x: Math.round(location.x + size.width / 2), y: Math.round(y) })
    .down()
    .up()
    .perform();
  await expect(view.$('.slice-label')).toHaveText(
    `Slice: ${index + 1}/${count}`
  );
}

describe('Local DICOM import regressions', () => {
  it('keeps the planned 5 mm spacing with slightly different slice orientations', async () => {
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
        rows: 4,
        cols: 4,
        pixelValue: i,
      })
    );

    await dropFiles(files);
    await volViewPage.waitForVolumeCardSliceCounts([121]);
    await volViewPage.waitForViews();
    await expect($('.loading-indicator')).not.toBeExisting();
    await openSpacingDetails();
    await expect($('[data-testid="spacing-axis-Z"]')).toHaveText(
      expect.stringContaining('5 mm')
    );
    await $('[data-testid="spacing-details-close"]').click();
    const view = await axialView(121);
    for (const index of [0, 60, 120]) {
      await selectSlice(view, index, 121);
      await probeCenter(view, index);
    }
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('loads pixels from a file containing an undefined-length private UN sequence', async () => {
    const content = toImplicitVr(
      rawElement(0x0043, 0x1030, 'LO', new TextEncoder().encode('VALUE '))
    );
    await dropFiles([
      buildSyntheticDicom({
        studyUid: newUid(),
        seriesUid: newUid(),
        sopUid: newUid(),
        instanceNumber: 1,
        imageOrientationPatient: AXIAL,
        imagePositionPatient: [0, 0, 0],
        rows: 4,
        cols: 4,
        pixelValue: 123,
        extraElements: [
          rawElement(0x0043, 0x0010, 'LO', new TextEncoder().encode('TEST')),
          undefinedLengthUnknown(0x0043, 0x1029, sequenceItem(content)),
        ],
      }),
    ]);

    await volViewPage.waitForVolumeCardSliceCounts([1]);
    await volViewPage.waitForViews();
    await expect($('.loading-indicator')).not.toBeExisting();
    await probeCenter(await axialView(1), 123);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('renders green and blue content in a color DICOM thumbnail without red samples', async () => {
    await dropFiles([
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
    await volViewPage.waitForVolumeCardSliceCounts([1]);
    const thumbnail = $('.volume-card .thumbnail-container img');
    await expect(thumbnail).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/png;base64,/)
    );
    const source = await thumbnail.getAttribute('src');
    if (!source) throw new Error('Expected a visible PNG thumbnail');
    const pixels = PNG.sync.read(Buffer.from(source.split(',')[1], 'base64'));
    expect(Array.from(pixels.data.slice(0, 12))).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 50, 50, 50, 255,
    ]);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
