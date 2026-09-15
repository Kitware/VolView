import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { writeManifestToFile, waitForDownload } from './utils';
import { openAnnotationSegments } from './segmentationTestUtils';

const maybeGunzip = (bytes: Buffer) =>
  bytes.readUInt16BE(0) === 0x1f8b ? gunzipSync(bytes) : bytes;

const readLabels = (file: string) => {
  const bytes = maybeGunzip(readFileSync(join(TEMP_DIR, file)));
  const end = bytes.indexOf(Buffer.from('\n\n'));
  expect(end).toBeGreaterThan(0);
  const header = bytes.subarray(0, end).toString();
  const data = maybeGunzip(bytes.subarray(end + 2));
  const type = header.match(/^type:\s*(.+)$/m)![1].trim();
  const wide = ['unsigned short', 'ushort', 'uint16'].includes(type);
  const count = data.length / (wide ? 2 : 1);
  const values = Array.from({ length: count }, (_, index) => {
    if (!wide) return data[index];
    return header.includes('endian: big')
      ? data.readUInt16BE(index * 2)
      : data.readUInt16LE(index * 2);
  });
  return {
    header,
    wide,
    labels: [...new Set(values.filter(Boolean))].sort((a, b) => a - b),
  };
};

const writeCase = (stem: string, labels: number[]) => {
  const header = [
    'NRRD0005',
    'type: unsigned short',
    'dimension: 3',
    'sizes: 16 16 16',
    'space: left-posterior-superior',
    'space origin: (0,0,0)',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'endian: little',
    'encoding: raw',
  ];
  const data = Buffer.alloc(4096 * 2);
  writeFileSync(
    join(TEMP_DIR, `${stem}.nrrd`),
    Buffer.concat([Buffer.from(`${header.join('\n')}\n\n`), data])
  );
  labels.forEach((value, index) => {
    data.writeUInt16LE(value, index * 2);
    header.push(
      `Segment${index}_LabelValue:=${value}`,
      `Segment${index}_Name:=Region ${value}`
    );
  });
  writeFileSync(
    join(TEMP_DIR, `${stem}.seg.nrrd`),
    Buffer.concat([Buffer.from(`${header.join('\n')}\n\n`), data])
  );
};

const openLabels = async (stem: string, file: string, count: number) => {
  await volViewPage.open(
    `?urls=[tmp/adaptive-labelmap-config.json,tmp/${stem}.nrrd,tmp/${file}]`
  );
  await volViewPage.waitForViews();
  await openAnnotationSegments();
  await browser.waitUntil(
    async () =>
      (await browser.execute(
        () =>
          document.querySelectorAll(
            '[data-testid="segment-list"] .item-row .v-list-item-title'
          ).length
      )) === count,
    { timeoutMsg: `Expected ${count} imported segments` }
  );
};

describe('Adaptive labelmap export width', function () {
  this.timeout(120_000);
  for (const labels of [
    Array.from({ length: 255 }, (_, i) => i + 1),
    Array.from({ length: 256 }, (_, i) => i + 1),
    [256, 65535],
  ]) {
    it(`round-trips ${labels.length} labels with ${labels.at(-1)} as the highest input value`, async () => {
      const stem = `adaptive-${labels.length}`;
      writeCase(stem, labels);
      await writeManifestToFile(
        { io: { segmentationExtension: 'seg' } },
        'adaptive-labelmap-config.json'
      );
      await openLabels(stem, `${stem}.seg.nrrd`, labels.length);
      const saveButton = $('button[data-testid="save-segments-button"]');
      await saveButton.waitForEnabled();
      await browser.execute((button) => button.focus(), await saveButton);
      await browser.keys(' ');
      await volViewPage.activeDialog.waitForDisplayed();
      await volViewPage.saveSegmentsFilenameInput.waitForDisplayed();
      await expect(
        $('[data-testid="save-overlap-notice"]')
      ).not.toBeDisplayed();
      const output = `${stem}-export.seg.nrrd`;
      rmSync(join(TEMP_DIR, output), { force: true });
      await setValueVueInput(
        volViewPage.saveSegmentsFilenameInput,
        `${stem}-export`
      );
      await volViewPage.saveSegmentsConfirmButton.click();
      await waitForDownload(join(TEMP_DIR, output), 40_000);
      const saved = readLabels(output);
      expect(saved.wide).toBe(labels.length > 255);
      expect(saved.labels).toEqual(
        Array.from({ length: labels.length }, (_, i) => i + 1)
      );
      expect(saved.header).toContain(`Region ${labels.at(-1)}`);
      await openLabels(stem, output, labels.length);
      expect(await volViewPage.getNotificationsCount()).toBe(0);
    });
  }
});
