import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import { test, expect } from '../fixtures';
import { expectWithinTest } from '../e2eRun';

// 268M voxels — labelmap at this size triggers Array.from OOM
const DIM_X = 1024;
const DIM_Y = 1024;
const DIM_Z = 256;

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

test.describe('Save large labelmap', () => {
  test('saves session without error when labelmap exceeds 200M voxels', async ({
    volview,
    utils,
    scratch,
  }) => {
    test.slow();
    const prefix = `save-large-${Date.now()}`;
    const baseFileName = `${prefix}-u8.nii.gz`;

    scratch.writeFile(baseFileName, createUint8NiftiGz());

    const manifest = { resources: [{ url: `/tmp/${baseFileName}` }] };
    const manifestFileName = `${prefix}-manifest.json`;
    await utils.writeManifestToFile(manifest, manifestFileName);

    await volview.open(`?urls=[tmp/${manifestFileName}]`);
    await volview.waitForViews(expectWithinTest);

    await volview.activatePaint();

    // Paint a stroke to allocate the labelmap
    await volview.paintStrokeOnView(volview.views2D.first());

    const notificationsBefore = await volview.getNotificationsCount();

    // Save session — before fix, this throws RangeError: Invalid array length
    const saving = { done: false };
    const save = volview.saveSession().then((name) => {
      saving.done = true;
      return name;
    });

    // Wait for either the file to appear (success) or notification (error)
    await expectWithinTest
      .poll(
        async () =>
          saving.done ||
          (await volview.getNotificationsCount()) > notificationsBefore
      )
      .toBe(true);

    if (!saving.done) {
      const errorDetails = (await volview.getNotificationTitles()).join('\n');
      throw new Error(`Save error:\n${errorDetails}`);
    }

    const stat = fs.statSync(scratch.path(await save));
    expect(stat.size).toBeGreaterThan(0);
  });
});
