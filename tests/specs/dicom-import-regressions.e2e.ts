import { volViewPage } from '../pageobjects/volview.page';
import {
  buildSyntheticDicom,
  newUid,
  rawElement,
  sequenceItem,
  toImplicitVr,
  undefinedLengthUnknown,
} from './syntheticDicom';
import {
  waitForFirstCachedImageSpacing,
  waitForFirstCompleteCachedImageScalars,
} from './imageCacheUtils';

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
    const { values } = await waitForFirstCompleteCachedImageScalars();
    expect(values).toEqual(
      Array.from({ length: 121 }, (_, i) => Array(16).fill(i)).flat()
    );
    expect(await waitForFirstCachedImageSpacing()).toEqual([1, 1, 5]);
    await volViewPage.waitForVolumeCardSliceCounts([121]);
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

    const { values } = await waitForFirstCompleteCachedImageScalars();
    expect(values).toEqual(Array(16).fill(123));
    await volViewPage.waitForVolumeCardSliceCounts([1]);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
