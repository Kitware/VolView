import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  setValueVueInput,
  type VolViewPage,
} from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import type { SegmentationUtils } from './segmentationTestUtils';

const maybeGunzip = (bytes: Buffer) =>
  bytes.readUInt16BE(0) === 0x1f8b ? gunzipSync(bytes) : bytes;

const readLabels = (filePath: string) => {
  const bytes = maybeGunzip(readFileSync(filePath));
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

const writeCase = (scratch: Scratch, stem: string, labels: number[]) => {
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
  scratch.writeFile(
    `${stem}.nrrd`,
    Buffer.concat([Buffer.from(`${header.join('\n')}\n\n`), data])
  );
  labels.forEach((value, index) => {
    data.writeUInt16LE(value, index * 2);
    header.push(
      `Segment${index}_LabelValue:=${value}`,
      `Segment${index}_Name:=Region ${value}`
    );
  });
  scratch.writeFile(
    `${stem}.seg.nrrd`,
    Buffer.concat([Buffer.from(`${header.join('\n')}\n\n`), data])
  );
};

const openLabels = async (
  {
    page,
    volview,
    segmentation,
  }: { page: Page; volview: VolViewPage; segmentation: SegmentationUtils },
  stem: string,
  file: string,
  count: number
) => {
  await volview.open(
    `?urls=[tmp/adaptive-labelmap-config.json,tmp/${stem}.nrrd,tmp/${file}]`
  );
  await volview.waitForViews();
  await segmentation.openAnnotationSegments();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.querySelectorAll(
              '[data-testid="segment-list"] .item-row .v-list-item-title'
            ).length
        ),
      { message: `Expected ${count} imported segments` }
    )
    .toBe(count);
};

test.describe('Adaptive labelmap export width', () => {
  for (const labels of [
    Array.from({ length: 255 }, (_, i) => i + 1),
    Array.from({ length: 256 }, (_, i) => i + 1),
    [256, 65535],
  ]) {
    test(`round-trips ${labels.length} labels with ${labels.at(-1)} as the highest input value`, async ({
      page,
      scratch,
      volview,
      utils,
      segmentation,
      saveDownload,
    }) => {
      const opened = { page, volview, segmentation };
      const stem = `adaptive-${labels.length}`;
      writeCase(scratch, stem, labels);
      await utils.writeManifestToFile(
        { io: { segmentationExtension: 'seg' } },
        'adaptive-labelmap-config.json'
      );
      await openLabels(opened, stem, `${stem}.seg.nrrd`, labels.length);
      const saveButton = page.locator(
        'button[data-testid="save-segments-button"]'
      );
      await expect(saveButton).toBeEnabled();
      await saveButton.focus();
      await page.keyboard.press('Space');
      await expect(volview.activeDialog).toBeVisible();
      await expect(volview.saveSegmentsFilenameInput).toBeVisible();
      await expect(
        page.locator('[data-testid="save-overlap-notice"]')
      ).toBeHidden();
      const output = `${stem}-export.seg.nrrd`;
      await setValueVueInput(
        volview.saveSegmentsFilenameInput,
        `${stem}-export`
      );
      const savedPath = await saveDownload(() =>
        volview.saveSegmentsConfirmButton.click()
      );
      const saved = readLabels(savedPath);
      expect(saved.wide).toBe(labels.length > 255);
      expect(saved.labels).toEqual(
        Array.from({ length: labels.length }, (_, i) => i + 1)
      );
      expect(saved.header).toContain(`Region ${labels.at(-1)}`);
      await openLabels(opened, stem, output, labels.length);
      expect(await volview.getNotificationsCount()).toBe(0);
    });
  }
});
