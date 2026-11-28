import * as zlib from 'node:zlib';
import JSZip from 'jszip';
import type { ConsoleMessage } from '@playwright/test';
import { test, expect } from '../fixtures';
import { expectWithinTest } from '../e2eRun';

const createNiftiGz = (
  dimX: number,
  dimY: number,
  dimZ: number,
  datatype: number,
  bitpix: number,
  foreground = false
) => {
  const bytesPerVoxel = bitpix / 8;
  const header = Buffer.alloc(352);

  header.writeInt32LE(348, 0);
  header.writeInt16LE(3, 40);
  header.writeInt16LE(dimX, 42);
  header.writeInt16LE(dimY, 44);
  header.writeInt16LE(dimZ, 46);
  header.writeInt16LE(1, 48);
  header.writeInt16LE(1, 50);
  header.writeInt16LE(1, 52);
  header.writeInt16LE(datatype, 70);
  header.writeInt16LE(bitpix, 72);
  header.writeFloatLE(1, 76);
  header.writeFloatLE(1, 80);
  header.writeFloatLE(1, 84);
  header.writeFloatLE(1, 88);
  header.writeFloatLE(352, 108);
  header.writeFloatLE(1, 112);
  header.writeInt16LE(1, 254);
  header.writeFloatLE(1, 280);
  header.writeFloatLE(0, 284);
  header.writeFloatLE(0, 288);
  header.writeFloatLE(0, 292);
  header.writeFloatLE(0, 296);
  header.writeFloatLE(1, 300);
  header.writeFloatLE(0, 304);
  header.writeFloatLE(0, 308);
  header.writeFloatLE(0, 312);
  header.writeFloatLE(0, 316);
  header.writeFloatLE(1, 320);
  header.writeFloatLE(0, 324);
  header.write('n+1\0', 344, 'binary');

  const imageData = Buffer.alloc(dimX * dimY * dimZ * bytesPerVoxel);
  // The labelmap needs actual content to distinguish decoded mask storage
  // from the segment catalog published at the start of restoration.
  if (foreground) imageData[imageData.length / 2] = 1;
  return zlib.gzipSync(Buffer.concat([header, imageData]), { level: 1 });
};

const createSessionZip = async (
  baseFileName: string,
  labelmapNiftiGz: Buffer
) => {
  const manifest = {
    version: '6.2.0',
    dataSources: [
      {
        id: 0,
        type: 'uri',
        uri: `/tmp/${baseFileName}`,
        name: baseFileName,
      },
    ],
    datasets: [{ id: '0', dataSourceId: 0 }],
    // Heap growth is the regression trigger; a single slice avoids allocating
    // a second large GPU texture for volume rendering in headless browsers.
    layout: { direction: 'row', items: [{ type: 'slot', slotIndex: 0 }] },
    layoutSlots: ['axial'],
    activeView: 'axial',
    viewByID: {
      axial: {
        id: 'axial',
        type: '2D',
        name: 'Axial',
        dataID: '0',
        options: { orientation: 'Axial' },
      },
    },
    segmentGroups: [
      {
        id: 'seg-1',
        path: 'segmentations/seg-1.nii.gz',
        metadata: {
          name: 'Annotation',
          parentImage: '0',
          segments: {
            order: [1],
            byValue: {
              '1': {
                value: 1,
                name: 'Label 1',
                color: [255, 0, 0, 255],
                visible: true,
              },
            },
          },
        },
      },
    ],
  };

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('segmentations/seg-1.nii.gz', labelmapNiftiGz);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
};

/**
 * Regression test for WASM signed pointer overflow during session restore.
 *
 * A .volview.zip session with a large Float32 URI-based base image and an
 * embedded .nii.gz labelmap. The import pipeline loads the base image
 * through the shared ITK-wasm worker, growing the WASM heap past 2GB.
 * Then segmentationStore.deserialize() calls readImage() for the embedded
 * .nii.gz labelmap on the same worker.
 *
 * The .nii.gz format is critical: .vti labelmaps use a separate JS
 * reader and never touch the ITK-wasm worker.
 *
 * Without resetting the worker, Emscripten's ccall returns output pointers
 * as signed i32. When pointers exceed 2^31 they wrap negative, causing:
 *   RangeError: Start offset -N is outside the bounds of the buffer
 *
 * Fix: resetWorker() before deserializing labelmaps clears the heap.
 */
test.describe('Session with large URI base and nii.gz labelmap', () => {
  test('loads session with large Float32 base and embedded nii.gz labelmap', async ({
    page,
    volview,
    utils,
    segmentation,
    scratch,
  }) => {
    test.slow();
    const prefix = `session-large-${Date.now()}`;
    const baseFileName = `${prefix}-base-f32.nii.gz`;
    const sessionFileName = `${prefix}-session.volview.zip`;

    // Float32 1024×1024×256 = 1GB raw — pushes WASM heap past 2GB
    scratch.writeFile(baseFileName, createNiftiGz(1024, 1024, 256, 16, 32));

    // UInt8 labelmap same dimensions = 256MB raw, embedded in session ZIP
    const labelmapNiftiGz = createNiftiGz(1024, 1024, 256, 2, 8, true);
    const sessionZip = await createSessionZip(baseFileName, labelmapNiftiGz);
    scratch.writeFile(sessionFileName, sessionZip);

    // A 1 GB float volume texture is more than software GL can allocate, and
    // the heap is what this spec is about. Disabling the 3D view type is not
    // enough: the view that replaces it allocates the same texture.
    const configFileName = `${prefix}-config.json`;
    await utils.writeManifestToFile(
      { layouts: { 'Axial Only': [['axial']] } },
      configFileName
    );

    const rangeErrors: string[] = [];
    const onLogEntry = (text: string) => {
      if (text.includes('RangeError')) {
        rangeErrors.push(text);
      }
    };
    const onConsole = (message: ConsoleMessage) => onLogEntry(message.text());
    const onPageError = (error: Error) =>
      onLogEntry(error.stack ?? String(error));
    page.on('console', onConsole);
    page.on('pageerror', onPageError);

    try {
      await volview.open(
        `?urls=[tmp/${sessionFileName},tmp/${configFileName}]`
      );
      await volview.waitForViews(expectWithinTest);

      // The restored layout renders its views before the base image loads,
      // and the segment list only appears once that image is shown.
      await volview.annotationsModuleTab.click();

      // This session contains no shapes. Reveal can only become enabled once
      // the embedded labelmap has decoded and its foreground mask is attached.
      const reveal = page.locator(
        '[data-testid="segment-list"] button[data-testid="reveal-segment-button"]'
      );

      await expectWithinTest
        .poll(
          async () => {
            if (rangeErrors.length > 0) return true;
            if ((await volview.getNotificationsCount()) > 0) return true;
            return (await reveal.count()) > 0 && (await reveal.isEnabled());
          },
          {
            message: 'Labelmap load never completed or errored',
          }
        )
        .toBe(true);

      expect(rangeErrors).toEqual([]);
      expect(await volview.getNotificationsCount()).toBe(0);
      expect(await segmentation.segmentNames()).toEqual(['Label 1']);
      expect(await reveal.isEnabled()).toBe(true);
    } finally {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    }
  });
});
