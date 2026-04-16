import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { volViewPage } from '../pageobjects/volview.page';
import { DOWNLOAD_TIMEOUT, TEMP_DIR } from '../../wdio.shared.conf';
import { writeManifestToFile, waitForFileExists } from './utils';

// 268M voxels — labelmap at this size triggers Array.from OOM
const DIM_X = 1024;
const DIM_Y = 1024;
const DIM_Z = 256;

const writeBufferToFile = async (data: Buffer, fileName: string) => {
  const filePath = path.join(TEMP_DIR, fileName);
  await fs.promises.writeFile(filePath, data);
  cleanuptotal.addCleanup(async () => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  return filePath;
};

// UInt8 base image — small compressed size, fast to load
const createUint8NiftiGz = () => {
  const header = Buffer.alloc(352);
  header.writeInt32LE(348, 0);
  header.writeInt16LE(3, 40);
  header.writeInt16LE(DIM_X, 42);
  header.writeInt16LE(DIM_Y, 44);
  header.writeInt16LE(DIM_Z, 46);
  header.writeInt16LE(1, 48);
  header.writeInt16LE(1, 50);
  header.writeInt16LE(1, 52);
  header.writeInt16LE(2, 70); // datatype: UINT8
  header.writeInt16LE(8, 72); // bitpix
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

  const imageData = Buffer.alloc(DIM_X * DIM_Y * DIM_Z);
  return zlib.gzipSync(Buffer.concat([header, imageData]), { level: 1 });
};

describe('Save large labelmap', function () {
  this.timeout(180_000);

  it('saves session without error when labelmap exceeds 200M voxels', async () => {
    const prefix = `save-large-${Date.now()}`;
    const baseFileName = `${prefix}-u8.nii.gz`;

    await writeBufferToFile(createUint8NiftiGz(), baseFileName);

    const manifest = { resources: [{ url: `/tmp/${baseFileName}` }] };
    const manifestFileName = `${prefix}-manifest.json`;
    await writeManifestToFile(manifest, manifestFileName);

    await volViewPage.open(`?urls=[tmp/${manifestFileName}]`);
    await volViewPage.waitForViews(DOWNLOAD_TIMEOUT * 6);

    // Activate paint tool — creates a segment group
    await volViewPage.activatePaint();

    // Paint a stroke to allocate the labelmap
    const views2D = await volViewPage.getViews2D();
    const canvas = await views2D[0].$('canvas');
    const location = await canvas.getLocation();
    const size = await canvas.getSize();
    const cx = Math.round(location.x + size.width / 2);
    const cy = Math.round(location.y + size.height / 2);

    await browser
      .action('pointer')
      .move({ x: cx, y: cy })
      .down()
      .move({ x: cx + 20, y: cy })
      .up()
      .perform();

    const notificationsBefore = await volViewPage.getNotificationsCount();

    // Save session — before fix, this throws RangeError: Invalid array length
    const sessionFileName = await volViewPage.saveSession();
    const downloadedPath = path.join(TEMP_DIR, sessionFileName);

    // Wait for either the file to appear (success) or notification (error)
    const saveResult = await Promise.race([
      waitForFileExists(downloadedPath, 90_000).then(() => 'saved' as const),
      browser
        .waitUntil(
          async () => {
            const count = await volViewPage.getNotificationsCount();
            return count > notificationsBefore;
          },
          { timeout: 90_000, interval: 1000 }
        )
        .then(() => 'error' as const),
    ]);

    if (saveResult === 'error') {
      const errorDetails = await browser.execute(() => {
        const app = document.querySelector('#app') as any;
        const pinia = app?.__vue_app__?.config?.globalProperties?.$pinia;
        if (!pinia) return 'no pinia';
        const store = pinia.state.value.message;
        if (!store) return 'no message store';
        return store.msgList
          .map((id: string) => {
            const msg = store.byID[id];
            return `[${msg.type}] ${msg.title}: ${msg.options?.details?.slice(0, 300)}`;
          })
          .join('\n');
      });
      throw new Error(`Save error:\n${errorDetails}`);
    }

    // Wait for the file to be fully written (Chrome may create it before flushing)
    await browser.waitUntil(
      () => {
        try {
          return fs.statSync(downloadedPath).size > 0;
        } catch {
          return false;
        }
      },
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg: 'Downloaded file remained 0 bytes',
      }
    );
    const stat = fs.statSync(downloadedPath);
    expect(stat.size).toBeGreaterThan(0);
  });
});
