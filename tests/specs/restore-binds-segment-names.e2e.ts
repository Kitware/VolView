import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { openThroughDialog, writeManifestToFile } from './utils';
import {
  openAnnotationSegments,
  segmentColor,
  segmentNames,
  waitForNamedSegments,
  waitForSegmentContent,
} from './segmentationTestUtils';

const SIZE = 16;
const STEM = 'restore-binds-names';

const nrrd = (data: Uint8Array) =>
  Buffer.concat([
    Buffer.from(
      `NRRD0005\ntype: unsigned char\ndimension: 3\nsizes: ${SIZE} ${SIZE} ${SIZE}\nspace: left-posterior-superior\nspace directions: (1,0,0) (0,1,0) (0,0,1)\nspace origin: (0,0,0)\nencoding: raw\n\n`
    ),
    data,
  ]);

const writeSession = async () => {
  const zip = new JSZip();
  zip.file('tumor-mask.nrrd', nrrd(new Uint8Array(SIZE ** 3).fill(1)));
  zip.file(
    'manifest.json',
    JSON.stringify({
      version: '7.0.0',
      dataSources: [{ id: 0, type: 'uri', uri: `/tmp/${STEM}.nrrd` }],
      segments: [{ id: 'tumor', name: 'Tumor', color: [0, 0, 255, 255] }],
      segmentations: [
        {
          id: 'segmentation',
          name: 'Session',
          parentImage: '0',
          order: ['tumor-mask'],
          masks: [
            {
              id: 'tumor-mask',
              segmentId: 'tumor',
              representations: {
                labelmap: {
                  path: 'tumor-mask.nrrd',
                  name: 'Tumor',
                  extent: [0, SIZE - 1, 0, SIZE - 1, 0, SIZE - 1],
                },
              },
            },
          ],
        },
      ],
    })
  );
  const sessionPath = path.join(TEMP_DIR, `${STEM}.volview.zip`);
  fs.writeFileSync(
    sessionPath,
    await zip.generateAsync({ type: 'nodebuffer' })
  );
  return sessionPath;
};

describe('Restoring a session into a configured scene', () => {
  it('binds a saved segment to the empty configured segment of its name', async () => {
    const parent = new Uint8Array(SIZE ** 3).map((_, offset) => offset % 251);
    fs.writeFileSync(path.join(TEMP_DIR, `${STEM}.nrrd`), nrrd(parent));
    await writeManifestToFile(
      { segments: { Tumor: { color: '#ff0000' } } },
      `${STEM}-config.json`
    );
    await volViewPage.open(`?urls=[tmp/${STEM}-config.json,tmp/${STEM}.nrrd]`);
    await volViewPage.waitForViews();
    await openAnnotationSegments();
    await waitForNamedSegments();
    expect(await segmentNames()).toEqual(['Tumor']);
    const configuredColor = await segmentColor('Tumor');

    await openThroughDialog(await writeSession());

    // Only a session segment bound to the first Tumor row gives it content.
    await waitForSegmentContent('Tumor');
    expect(await segmentNames()).toEqual(['Tumor']);
    expect(await segmentColor('Tumor')).toEqual(configuredColor);
    expect(await volViewPage.getNotificationsCount()).toEqual(0);
  });
});
