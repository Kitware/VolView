import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import JSZip from 'jszip';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { volViewPage } from '../pageobjects/volview.page';
import { DOWNLOAD_TIMEOUT, TEMP_DIR } from '../../wdio.shared.conf';

const writeBufferToFile = async (data: Buffer, fileName: string) => {
  const filePath = path.join(TEMP_DIR, fileName);
  await fs.promises.writeFile(filePath, data);
  cleanuptotal.addCleanup(async () => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  return filePath;
};

const createNiftiGz = (
  dimX: number,
  dimY: number,
  dimZ: number,
  datatype: number,
  bitpix: number
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
    segmentGroups: [
      {
        id: 'seg-1',
        path: 'labels/seg-1.nii.gz',
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
  zip.file('labels/seg-1.nii.gz', labelmapNiftiGz);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
};

/**
 * Regression test for WASM signed pointer overflow during session restore.
 *
 * A .volview.zip session with a large Float32 URI-based base image and an
 * embedded .nii.gz labelmap. The import pipeline loads the base image
 * through the shared ITK-wasm worker, growing the WASM heap past 2GB.
 * Then segmentGroupStore.deserialize() calls readImage() for the embedded
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
describe('Session with large URI base and nii.gz labelmap', function () {
  this.timeout(180_000);

  it('loads session with large Float32 base and embedded nii.gz labelmap', async () => {
    const prefix = `session-large-${Date.now()}`;
    const baseFileName = `${prefix}-base-f32.nii.gz`;
    const sessionFileName = `${prefix}-session.volview.zip`;

    // Float32 1024×1024×256 = 1GB raw — pushes WASM heap past 2GB
    await writeBufferToFile(
      createNiftiGz(1024, 1024, 256, 16, 32),
      baseFileName
    );

    // UInt8 labelmap same dimensions = 256MB raw, embedded in session ZIP
    const labelmapNiftiGz = createNiftiGz(1024, 1024, 256, 2, 8);
    const sessionZip = await createSessionZip(baseFileName, labelmapNiftiGz);
    await writeBufferToFile(sessionZip, sessionFileName);

    const rangeErrors: string[] = [];
    const onLogEntry = (logEntry: { text: string | null }) => {
      const text = logEntry.text ?? '';
      if (text.includes('RangeError')) {
        rangeErrors.push(text);
      }
    };
    browser.on('log.entryAdded', onLogEntry);

    try {
      await volViewPage.open(`?urls=[tmp/${sessionFileName}]`);
      await volViewPage.waitForViews(DOWNLOAD_TIMEOUT * 6);

      // Open the segment groups panel so the list renders in the DOM
      const annotationsTab = await $(
        'button[data-testid="module-tab-Annotations"]'
      );
      await annotationsTab.click();

      const segmentGroupsTab = await $('button.v-tab*=Segment Groups');
      await segmentGroupsTab.waitForClickable();
      await segmentGroupsTab.click();

      // Wait for the labelmap readImage to either succeed (segment group
      // appears) or fail (RangeError in console OR error notification).
      // The deserialization is async and finishes after views render.
      const notifsBefore = await volViewPage.getNotificationsCount();

      await browser.waitUntil(
        async () => {
          if (rangeErrors.length > 0) return true;
          try {
            const notifs = await volViewPage.getNotificationsCount();
            if (notifs > notifsBefore) return true;
          } catch {
            // badge may not exist yet
          }
          const segmentGroups = await $$('.segment-group-list .v-list-item');
          return (await segmentGroups.length) >= 1;
        },
        {
          timeout: DOWNLOAD_TIMEOUT * 3,
          timeoutMsg: 'Labelmap load never completed or errored',
        }
      );

      expect(rangeErrors).toEqual([]);
    } finally {
      browser.off('log.entryAdded', onLogEntry);
    }
  });
});
