import * as path from 'node:path';
import fs from 'node:fs';
import JSZip from 'jszip';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { ONE_CT_SLICE_DICOM } from '../datasets';
import {
  openUrls,
  openVolViewPage,
  waitForDownload,
  SESSION_SAVE_TIMEOUT,
} from './utils';
import {
  addSegment,
  openAnnotationSegments,
  segmentNames,
  selectSegment,
} from './segmentationTestUtils';

const selected = () =>
  $('[data-testid="segment-list"] .item-row[aria-current="true"]');
const segmentRow = (name: string) =>
  $(`[data-testid="segment-list"] .item-row[aria-label="${name}"]`);
const titles = () =>
  browser.execute(() =>
    Array.from(
      document.querySelectorAll('[data-testid="segment-list"] .item-row'),
      (row) => row.getAttribute('aria-label')
    )
  );

// Native drag events exercise the same handle/drop handlers without depending
// on a browser's drag-distance threshold or autoscroll timing.
const dragBefore = async (name: string, target: string) => {
  const row = await segmentRow(name);
  const destination = await segmentRow(target);
  const handle = await row.$('.reorder-handle');
  await browser.execute(
    (source, to) => {
      const dataTransfer = new DataTransfer();
      const bounds = to.getBoundingClientRect();
      source.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, dataTransfer })
      );
      to.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientY: bounds.top + 1,
        })
      );
    },
    handle,
    destination
  );
  await expect(destination).toHaveAttribute('data-drop-position', 'before');
  expect(
    await browser.execute(
      (element) => getComputedStyle(element).borderTopColor,
      destination
    )
  ).not.toBe('rgba(0, 0, 0, 0)');
  await browser.execute(
    (source, to) => {
      const dataTransfer = new DataTransfer();
      to.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientY: to.getBoundingClientRect().top + 1,
        })
      );
      source.dispatchEvent(
        new DragEvent('dragend', { bubbles: true, dataTransfer })
      );
    },
    handle,
    destination
  );
};

describe('Segment shortcuts and ordering', () => {
  it('cycles forward and backward across segment boundaries for polygon and paint', async () => {
    await volViewPage.open();
    await expect(volViewPage.samplesList).toBeDisplayed();
    await browser.keys('w');
    await browser.keys('q');
    await expect(volViewPage.samplesList).toBeDisplayed();
    await expect($('[data-testid="segment-list"]')).not.toExist();
    expect(await volViewPage.getNotificationsCount()).toBe(0);

    await openUrls([ONE_CT_SLICE_DICOM]);
    await openAnnotationSegments();
    await browser.keys('w');
    await browser.keys('q');
    expect(await segmentNames()).toEqual([]);

    for (let index = 0; index < 3; index++) await addSegment();
    for (const icon of ['mdi-pentagon-outline', 'mdi-brush']) {
      await volViewPage.selectTool(icon);
      await selectSegment('Segment 1');
      await browser.keys('q');
      await expect(selected()).toHaveAttribute('aria-label', 'Segment 3');
      await browser.keys('w');
      await expect(selected()).toHaveAttribute('aria-label', 'Segment 1');
      await browser.keys('w');
      await expect(selected()).toHaveAttribute('aria-label', 'Segment 2');
      await expect(volViewPage.saveSegmentsButtons[0]).toBeDisabled();
    }
  });

  it('cycles from the first row when a restored session names no selection', async () => {
    await openUrls([ONE_CT_SLICE_DICOM]);
    await openAnnotationSegments();
    for (let index = 0; index < 3; index++) await addSegment();
    const saved = await volViewPage.saveSession();
    const savedPath = path.join(TEMP_DIR, saved);
    await waitForDownload(savedPath, SESSION_SAVE_TIMEOUT);
    const zip = await JSZip.loadAsync(fs.readFileSync(savedPath));
    const manifest = JSON.parse(
      await zip.file('manifest.json')!.async('string')
    );
    delete manifest.selectedSegment;
    zip.file('manifest.json', JSON.stringify(manifest));
    const name = 'segment-shortcuts-no-selection.volview.zip';
    const filePath = path.join(TEMP_DIR, name);
    fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
    cleanuptotal.addCleanup(async () => fs.rmSync(filePath, { force: true }));

    for (const [key, expected] of [
      ['w', 'Segment 2'],
      ['q', 'Segment 3'],
    ]) {
      await openVolViewPage(name);
      await openAnnotationSegments();
      await expect(selected()).toHaveAttribute('aria-label', 'Segment 1');
      await browser.keys(key);
      await expect(selected()).toHaveAttribute('aria-label', expected);
    }
  });

  for (const [tool, icon] of [
    ['Paint', 'mdi-brush'],
    ['Polygon', 'mdi-pentagon-outline'],
    ['Rectangle', 'mdi-vector-square'],
    ['Ruler', 'mdi-ruler'],
  ]) {
    it(`keeps the selection when ${tool} is reactivated without creating painted content`, async () => {
      await openUrls([ONE_CT_SLICE_DICOM]);
      await volViewPage.selectTool(icon);
      await openAnnotationSegments();
      await expect(selected()).toHaveAttribute('aria-label', 'Segment 1');
      expect(await segmentNames()).toEqual(['Segment 1']);
      await expect(volViewPage.saveSegmentsButtons[0]).toBeDisabled();
      await volViewPage.selectTool('mdi-cursor-default');
      await volViewPage.selectTool(icon);
      await expect(selected()).toHaveAttribute('aria-label', 'Segment 1');
      expect(await segmentNames()).toEqual(['Segment 1']);

      await addSegment();
      await volViewPage.selectTool('mdi-cursor-default');
      await volViewPage.selectTool(icon);
      await expect(selected()).toHaveAttribute('aria-label', 'Segment 2');
      expect(await segmentNames()).toEqual(['Segment 1', 'Segment 2']);
      await expect(volViewPage.saveSegmentsButtons[0]).toBeDisabled();
    });
  }

  it('selects the first ten rows, follows reordered rows keeps typed digits in fields and restores saved order', async () => {
    await openUrls([ONE_CT_SLICE_DICOM]);
    await openAnnotationSegments();
    for (let i = 0; i < 11; i++) {
      await $('[data-testid="segment-list"] .create-row').click();
      await expect(segmentRow(`Segment ${i + 1}`)).toExist();
    }

    for (let i = 1; i <= 10; i++) {
      await browser.keys(String(i % 10));
      await expect(selected()).toHaveAttribute('aria-label', `Segment ${i}`);
      await expect((await segmentRow(`Segment ${i}`)).$('kbd')).toHaveText(
        String(i % 10)
      );
    }
    await expect((await segmentRow('Segment 11')).$('kbd')).not.toExist();

    await dragBefore('Segment 11', 'Segment 1');
    await browser.waitUntil(async () => (await titles())[0] === 'Segment 11');
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 10');
    await browser.keys('1');
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 11');
    await browser.keys('0');
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 9');
    await expect((await segmentRow('Segment 10')).$('kbd')).not.toExist();

    const firstHandle = (await segmentRow('Segment 11')).$('.reorder-handle');
    await firstHandle.click();
    await browser.keys(['Alt', 'ArrowDown']);
    await browser.waitUntil(async () => (await titles())[1] === 'Segment 11');
    await browser.keys('1');
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 1');

    await (await segmentRow('Segment 1'))
      .$('[data-testid="edit-segment-button"]')
      .click();
    const input = $('div[role="dialog"] .v-text-field input');
    await input.click();
    await input.addValue('1234567890');
    await expect(input).toHaveValue('Segment 11234567890');
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 1');
    await volViewPage.editLabelModalDoneButton.click();
    await expect(selected()).toHaveAttribute(
      'aria-label',
      'Segment 11234567890'
    );
    const order = await titles();
    const session = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, session), SESSION_SAVE_TIMEOUT);
    await volViewPage.open(`?urls=[tmp/${session}]`);
    await volViewPage.waitForViews();
    await openAnnotationSegments();
    await browser.waitUntil(
      async () => (await titles()).length === order.length
    );
    expect(await titles()).toEqual(order);
    await expect(selected()).toHaveAttribute(
      'aria-label',
      'Segment 11234567890'
    );
    await browser.keys('2');
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 11');
    await browser.keys('0');
    await expect(selected()).toHaveAttribute('aria-label', 'Segment 9');
  });
});
