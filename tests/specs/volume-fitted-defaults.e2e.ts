import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { containsText } from '../pageobjects/volview.page';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import { differingFraction, VIEW, type VolumeUtils } from './volumeTestUtils';

const sliceValue = (index: number) => 100 * (index + 1);

function writeDicomSeries(
  directory: string,
  modality: string,
  slices = 4,
  valueAt = sliceValue
) {
  const studyUid = newUid();
  const seriesUid = newUid();
  return Array.from({ length: slices }, (_, index) => {
    const name = `slice-${index}.dcm`;
    fs.writeFileSync(
      path.join(directory, name),
      buildSyntheticDicom({
        studyUid,
        seriesUid,
        sopUid: newUid(),
        modality,
        instanceNumber: index + 1,
        rows: 8,
        cols: 8,
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        imagePositionPatient: [0, 0, index],
        pixelValue: valueAt(index),
      })
    );
    return { url: `tmp/${path.basename(directory)}/${name}`, name };
  });
}

async function expectSelectedPreset(volume: VolumeUtils, label: string) {
  await volume.openRenderingModule();
  await volume.showColorPresets();
  await expect(volume.selectedPreset()).toHaveText(label);
}

const presetThumbnail = (page: Page, label: string) =>
  page
    .locator('.thumbnail-container', { hasText: containsText(label) })
    .first();

test.describe('default volume preset', () => {
  test('selects Grayscale for untagged data that is not in Hounsfield units', async ({
    utils,
    volume,
  }) => {
    const name = 'default-preset-untagged';
    await volume.openWith3DLayout(
      `tmp/${utils.writeMetaImage(`${name}.mha`, { size: 8 })}`,
      name
    );
    await expectSelectedPreset(volume, 'Grayscale');
  });

  test('selects MR Default for an MR DICOM series', async ({
    utils,
    volume,
  }) => {
    const name = 'dicom-mr-preset';
    const directory = utils.makeTempDir(name);
    const manifest = `${name}.json`;
    await utils.writeManifestToFile(
      { resources: writeDicomSeries(directory, 'MR') },
      manifest
    );
    await volume.openWith3DLayout(`tmp/${manifest}`, name);
    await expectSelectedPreset(volume, 'MR Default');
  });

  test('fits Grayscale to a DICOM series of an unlisted modality', async ({
    utils,
    volume,
  }) => {
    const name = 'dicom-pt-preset';
    const directory = utils.makeTempDir(name);
    const manifest = `${name}.json`;
    await utils.writeManifestToFile(
      { resources: writeDicomSeries(directory, 'PT') },
      manifest
    );
    await volume.openWith3DLayout(`tmp/${manifest}`, name);
    await expectVisibleVolume(volume, name);
    await expectSelectedPreset(volume, 'Grayscale');
  });
});

// The inset keeps only the view center, where every test volume has signal.
const CENTER_INSET = 280;

async function brightCenterPixels(
  volume: VolumeUtils,
  name: string,
  inset: number,
  level = 40
) {
  // The view has no size under the loading overlay, and expect.poll stops on a throw.
  const data = await volume
    .viewPixels(VIEW, inset, `${name}.png`)
    .catch((error: Error) => {
      if (!error.message.startsWith('Expected a nonempty view crop'))
        throw error;
      return Buffer.alloc(0);
    });
  if (data.length === 0) return { bright: 0, fraction: 0 };
  let bright = 0;
  for (let index = 0; index < data.length; index += 4)
    if (Math.max(data[index], data[index + 1], data[index + 2]) > level)
      bright++;
  return { bright, fraction: bright / (data.length / 4) };
}

async function expectVisibleVolume(volume: VolumeUtils, name: string) {
  await expect
    .poll(
      async () => (await brightCenterPixels(volume, name, CENTER_INSET)).bright,
      { message: `Expected ${name} to render visibly in the 3D view` }
    )
    .toBeGreaterThan(50);
}

test.describe('grayscale default fitted to the data', () => {
  // Software-rendered 3D frames on CI cost time in proportion to volume depth.
  const SIZE = 32;
  const coordinates = (index: number) => [
    index % SIZE,
    Math.floor(index / SIZE) % SIZE,
    Math.floor(index / SIZE ** 2),
  ];

  test('guesses CT AAA for untagged data in Hounsfield units', async ({
    volume,
  }) => {
    const name = 'fitted-untagged-hu';
    const url = volume.writeFloatVolume(name, SIZE, (index) => {
      const radius = Math.hypot(...coordinates(index).map((c) => c - SIZE / 2));
      if (radius < SIZE / 8) return 700;
      return radius < (3 * SIZE) / 8 ? 40 : -1024;
    });
    await volume.openWith3DLayout(url, name);
    await expectVisibleVolume(volume, name);
    await expectSelectedPreset(volume, 'CT AAA');
  });

  test('shows a small block on a zero background with a bright outlier', async ({
    volume,
  }) => {
    const name = 'fitted-sparse';
    const url = volume.writeFloatVolume(name, SIZE, (index) => {
      if (index === 0) return 1e6;
      const inBlock = coordinates(index).every(
        (c) => c >= SIZE / 2 - 4 && c < SIZE / 2 + 4
      );
      return inBlock ? 500 + (index % 7) : 0;
    });
    await volume.openWith3DLayout(url, name);
    // Before the fit the block is black against the outlier's range.
    await volume.openRenderingModule();
    await volume.waitForFittedColorRange(1e6);
    await expectVisibleVolume(volume, name);
    await expectSelectedPreset(volume, 'Grayscale');
  });

  test('renders the brightest voxels opaque, so a binary mask face is solid', async ({
    volume,
  }) => {
    const name = 'fitted-binary';
    const url = volume.writeFloatVolume(name, SIZE, (index) =>
      coordinates(index).every((c) => c >= SIZE / 4 && c < (3 * SIZE) / 4)
        ? 1
        : 0
    );
    await volume.openWith3DLayout(url, name);
    await expectSelectedPreset(volume, 'Grayscale');
    // A transparent top of range leaves only a speckled shell of interpolated samples.
    await expect
      .poll(
        async () => (await brightCenterPixels(volume, name, 320, 150)).fraction,
        { message: 'Expected the binary mask face to render solid' }
      )
      .toBeGreaterThan(0.95);
  });

  test('fits an MR preset to the intensity scale', async ({
    utils,
    volume,
  }) => {
    const rendered = [];
    for (const scale of [1, 10]) {
      const name = `fitted-mr-x${scale}`;
      const manifest = `${name}.json`;
      await utils.writeManifestToFile(
        {
          resources: writeDicomSeries(
            utils.makeTempDir(name),
            'MR',
            8,
            (index) => scale * sliceValue(index)
          ),
        },
        manifest
      );
      await volume.openWith3DLayout(`tmp/${manifest}`, name);
      await expectVisibleVolume(volume, name);
      rendered.push(await volume.stablePixels(VIEW, 40));
    }
    // Ray jitter differs on a few percent of pixels; an unfit preset on most.
    expect(differingFraction(rendered[0], rendered[1])).toBeLessThan(0.05);
  });

  test('refits a streamed MR series to its loaded intensities', async ({
    page,
    utils,
    volume,
  }) => {
    // A bright first slice under 1% of the voxels widens the data range far
    // beyond the fitted range.
    const open = async (name: string) => {
      const manifest = `${name}.json`;
      await utils.writeManifestToFile(
        {
          resources: writeDicomSeries(
            utils.makeTempDir(name),
            'MR',
            120,
            (index) => (index ? 100 + 5 * index : 30000)
          ),
        },
        manifest
      );
      await volume.openWith3DLayout(`tmp/${manifest}`, name);
      await expectVisibleVolume(volume, name);
    };

    // Choosing the preset again fits it to the loaded image's statistics.
    await open('fitted-mr-reference');
    await expectSelectedPreset(volume, 'MR Default');
    await presetThumbnail(page, 'Grayscale').click();
    await expect(volume.selectedPreset()).toHaveText('Grayscale');
    await presetThumbnail(page, 'MR Default').click();
    await expect(volume.selectedPreset()).toHaveText('MR Default');
    await volume.showColorPresets(false);
    const fitted = await volume.stablePixels(VIEW, 40);

    await open('fitted-mr-streamed');
    // Ray jitter differs on a few percent of pixels; an unfit range on far more.
    await expect
      .poll(
        async () =>
          differingFraction(fitted, await volume.stablePixels(VIEW, 40)),
        { message: 'Expected the streamed series to match a fresh fit' }
      )
      .toBeLessThan(0.1);
  });
});
