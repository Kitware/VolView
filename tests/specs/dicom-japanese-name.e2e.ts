import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { cleanuptotal } from 'wdio-cleanuptotal-service';

import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import { writeManifestToFile } from './utils';

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

// ESC $ B designates JIS X 0208, ESC ( B returns to ASCII, as ISO 2022 IR 87
// requires around every run of ideographic or phonetic characters.
const jisX0208 = (...codes: number[]) => [
  0x1b,
  0x24,
  0x42,
  ...codes,
  0x1b,
  0x28,
  0x42,
];

const JAPANESE_NAME = 'Yamada^Tarou=山田^太郎=やまだ^たろう';
const JAPANESE_NAME_BYTES = new Uint8Array([
  ...ascii('Yamada^Tarou='),
  ...jisX0208(0x3b, 0x33, 0x45, 0x44),
  ...ascii('^'),
  ...jisX0208(0x42, 0x40, 0x4f, 0x3a),
  ...ascii('='),
  ...jisX0208(0x24, 0x64, 0x24, 0x5e, 0x24, 0x40),
  ...ascii('^'),
  ...jisX0208(0x24, 0x3f, 0x24, 0x6d, 0x24, 0x26),
]);

const japaneseNameDicom = () =>
  buildSyntheticDicom({
    studyUid: newUid(),
    seriesUid: newUid(),
    sopUid: newUid(),
    instanceNumber: 1,
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    imagePositionPatient: [0, 0, 0],
    specificCharacterSet: 'ISO 2022 IR 6\\ISO 2022 IR 87',
    patientNameBytes: JAPANESE_NAME_BYTES,
  });

const writeTempFile = (fileName: string, contents: Uint8Array | Buffer) => {
  const filePath = path.join(TEMP_DIR, fileName);
  fs.writeFileSync(filePath, contents);
  cleanuptotal.addCleanup(async () => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  return fileName;
};

const patientHeaderNames = async () => {
  const headers = await $$('.patient-header-name');
  const names: string[] = [];
  for (const header of headers) {
    names.push(await header.getText());
  }
  return names;
};

const waitForPatientName = async (expected: string) => {
  let seen: string[] = [];
  await browser.waitUntil(
    async () => {
      seen = await patientHeaderNames();
      return seen.includes(expected);
    },
    {
      timeoutMsg: `expected a patient named ${expected}`,
    }
  );
  expect(seen).toContain(expected);
};

describe('DICOM patient name in a non-default character set', () => {
  it('decodes an ISO 2022 IR 87 name from a streamed DICOM', async () => {
    const stamp = Date.now();
    const fileName = writeTempFile(
      `japanese-name-${stamp}.dcm`,
      japaneseNameDicom()
    );
    const manifestName = `japanese-name-${stamp}.json`;
    await writeManifestToFile(
      { resources: [{ url: `/tmp/${fileName}`, name: fileName }] },
      manifestName
    );

    await volViewPage.open(`?urls=[tmp/${manifestName}]`);
    await volViewPage.waitForViews();

    await waitForPatientName(JAPANESE_NAME);
  });

  it('decodes an ISO 2022 IR 87 name from a DICOM inside an archive', async () => {
    const zip = new JSZip();
    zip.file('japanese-name.dcm', japaneseNameDicom());
    const zipName = writeTempFile(
      `japanese-name-${Date.now()}.zip`,
      await zip.generateAsync({ type: 'nodebuffer' })
    );

    await volViewPage.open(`?urls=[tmp/${zipName}]`);
    await volViewPage.waitForViews();

    await waitForPatientName(JAPANESE_NAME);
  });
});
