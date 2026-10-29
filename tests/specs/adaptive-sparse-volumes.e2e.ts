import fs from 'node:fs';
import path from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  createVolumeScalars,
  openVolumeRenderingControls,
} from './volumeRenderingTestUtils';
import { captureViewPixels, writeManifestToFile } from './utils';

function writeSparseVolume(
  name: string,
  size: number,
  first: number,
  background = 0
) {
  const width = size === 64 ? 1 : 3;
  const encoding = size > 32 ? 'uint16' : 'float';
  const voxels = createVolumeScalars(size, encoding, (x, y, z) =>
    [x, y, z].every((index) => index >= first && index < first + width)
      ? background + 1000
      : background
  );
  const header = [
    'NRRD0005',
    `type: ${encoding === 'uint16' ? 'ushort' : 'float'}`,
    'dimension: 3',
    `sizes: ${size} ${size} ${size}`,
    'space: left-posterior-superior',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: raw',
    'endian: little',
    '',
    '',
  ].join('\n');
  fs.writeFileSync(
    path.join(TEMP_DIR, name),
    Buffer.concat([Buffer.from(header), voxels])
  );
  return name;
}

async function expectSparseAppearance() {
  await browser.waitUntil(
    async () => {
      const [{ data }] = await captureViewPixels(
        '[data-testid~="vtk-volume-view"]',
        75,
        'sparse-volume.png'
      );
      let visible = 0;
      let background = 0;
      for (let index = 0; index < data.length; index += 4) {
        const value = Math.max(data[index], data[index + 1], data[index + 2]);
        if (value > 25) visible++;
        if (value < 5) background++;
      }
      return visible > 0 && background > (data.length / 4) * 0.95;
    },
    {
      timeoutMsg:
        'Expected visible sparse foreground surrounded by transparent background',
    }
  );
}

async function openSparseVolume(name: string) {
  await volViewPage.open(`?urls=[tmp/sparse-layout.json,tmp/${name}]`);
  await volViewPage.waitForViewCounts(0, true);
  await $('[data-testid~="vtk-volume-view"]').waitForDisplayed();
  await expectSparseAppearance();
}

describe('sparse adaptive volume rendering', () => {
  before(async () => {
    await writeManifestToFile(
      {
        layouts: {
          default: {
            direction: 'row',
            items: [
              { type: '3D', viewDirection: 'Superior', viewUp: 'Anterior' },
            ],
          },
        },
      },
      'sparse-layout.json'
    );
  });

  it('shows a small foreground block on both sides of a one-voxel translation', async () => {
    // The image exceeds the fitting sample budget; moving this isolated signal
    // by one voxel changes whether it falls on a sampled location.
    for (const first of [32, 31]) {
      await openSparseVolume(
        writeSparseVolume(`sparse-${first}.nrrd`, 64, first)
      );
    }
  });

  for (const background of [100, -1000]) {
    it(`separates sparse signal from a background of ${background}`, async () => {
      await openSparseVolume(
        writeSparseVolume(
          `sparse-offset-${background}.nrrd`,
          32,
          14,
          background
        )
      );
      await openVolumeRenderingControls();
      for (const profile of ['Transparent', 'Surface']) {
        const card = $(`[data-testid="volume-preset-Adaptive-${profile}"]`);
        await card.scrollIntoView({ block: 'center', behavior: 'instant' });
        await card.click();
        await expect(card).toHaveElementClass('bg-blue');
        await $('header').moveTo();
        await expectSparseAppearance();
      }
    });
  }
});
