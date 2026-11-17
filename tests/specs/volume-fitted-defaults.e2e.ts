import fs from 'node:fs';
import path from 'node:path';
import { volViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import {
  captureViewPixels,
  makeTempDir,
  waitForModuleTransitions,
  writeManifestToFile,
} from './utils';
import {
  differingFraction,
  floatVoxels,
  nrrd,
  showColorPresets,
  openWith3DLayout,
  selectedPreset,
  stablePixels,
  VIEW,
  waitForFittedColorRange,
  writeNrrd,
} from './volumeTestUtils';

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

async function openRenderingModule() {
  await volViewPage.renderingModuleTab.waitForClickable();
  await volViewPage.renderingModuleTab.click();
  await waitForModuleTransitions();
}

async function expectSelectedPreset(label: string) {
  await openRenderingModule();
  await showColorPresets();
  await expect(selectedPreset()).toHaveText(label);
}

describe('default volume preset', () => {
  it('selects Grayscale for untagged data that is not in Hounsfield units', async () => {
    const name = 'default-preset-untagged';
    const voxels = Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256));
    await openWith3DLayout(writeNrrd(name, nrrd([]), voxels), name);
    await expectSelectedPreset('Grayscale');
  });

  it('selects MR Default for an MR DICOM series', async () => {
    const name = 'dicom-mr-preset';
    const directory = makeTempDir(name);
    const manifest = `${name}.json`;
    await writeManifestToFile(
      { resources: writeDicomSeries(directory, 'MR') },
      manifest
    );
    await openWith3DLayout(`tmp/${manifest}`, name);
    await expectSelectedPreset('MR Default');
  });

  it('fits Grayscale to a DICOM series of an unlisted modality', async () => {
    const name = 'dicom-pt-preset';
    const directory = makeTempDir(name);
    const manifest = `${name}.json`;
    await writeManifestToFile(
      { resources: writeDicomSeries(directory, 'PT') },
      manifest
    );
    await openWith3DLayout(`tmp/${manifest}`, name);
    await expectVisibleVolume(name);
    await expectSelectedPreset('Grayscale');
  });
});

// The inset keeps only the view center, where every test volume has signal.
const CENTER_INSET = 280;

async function brightCenterPixels(name: string, inset: number, level = 40) {
  const [{ data }] = await captureViewPixels(VIEW, inset, `${name}.png`);
  let bright = 0;
  for (let index = 0; index < data.length; index += 4)
    if (Math.max(data[index], data[index + 1], data[index + 2]) > level)
      bright++;
  return { bright, fraction: bright / (data.length / 4) };
}

async function expectVisibleVolume(name: string) {
  await browser.waitUntil(
    async () => (await brightCenterPixels(name, CENTER_INSET)).bright > 50,
    { timeoutMsg: `Expected ${name} to render visibly in the 3D view` }
  );
}

describe('grayscale default fitted to the data', () => {
  // Software-rendered 3D frames on CI cost time in proportion to volume depth.
  const SIZE = 32;
  const coordinates = (index: number) => [
    index % SIZE,
    Math.floor(index / SIZE) % SIZE,
    Math.floor(index / SIZE ** 2),
  ];

  it('guesses CT AAA for untagged data in Hounsfield units', async () => {
    const name = 'fitted-untagged-hu';
    const voxels = floatVoxels(SIZE, (index) => {
      const radius = Math.hypot(...coordinates(index).map((c) => c - SIZE / 2));
      if (radius < SIZE / 8) return 700;
      return radius < (3 * SIZE) / 8 ? 40 : -1024;
    });
    await openWith3DLayout(
      writeNrrd(name, nrrd([], 'float', SIZE), voxels),
      name
    );
    await expectVisibleVolume(name);
    await expectSelectedPreset('CT AAA');
  });

  it('shows a small block on a zero background with a bright outlier', async () => {
    const name = 'fitted-sparse';
    const voxels = floatVoxels(SIZE, (index) => {
      if (index === 0) return 1e6;
      const inBlock = coordinates(index).every(
        (c) => c >= SIZE / 2 - 4 && c < SIZE / 2 + 4
      );
      return inBlock ? 500 + (index % 7) : 0;
    });
    await openWith3DLayout(
      writeNrrd(name, nrrd([], 'float', SIZE), voxels),
      name
    );
    // Before the fit the block is black against the outlier's range.
    await openRenderingModule();
    await waitForFittedColorRange(1e6);
    await expectVisibleVolume(name);
    await expectSelectedPreset('Grayscale');
  });

  it('renders the brightest voxels opaque, so a binary mask face is solid', async () => {
    const name = 'fitted-binary';
    const voxels = floatVoxels(SIZE, (index) =>
      coordinates(index).every((c) => c >= SIZE / 4 && c < (3 * SIZE) / 4)
        ? 1
        : 0
    );
    await openWith3DLayout(
      writeNrrd(name, nrrd([], 'float', SIZE), voxels),
      name
    );
    await expectSelectedPreset('Grayscale');
    // A transparent top of range leaves only a speckled shell of interpolated samples.
    await browser.waitUntil(
      async () => (await brightCenterPixels(name, 320, 150)).fraction > 0.95,
      { timeoutMsg: 'Expected the binary mask face to render solid' }
    );
  });

  it('fits an MR preset to the intensity scale', async () => {
    const rendered = [];
    for (const scale of [1, 10]) {
      const name = `fitted-mr-x${scale}`;
      const manifest = `${name}.json`;
      await writeManifestToFile(
        {
          resources: writeDicomSeries(
            makeTempDir(name),
            'MR',
            8,
            (index) => scale * sliceValue(index)
          ),
        },
        manifest
      );
      await openWith3DLayout(`tmp/${manifest}`, name);
      await expectVisibleVolume(name);
      rendered.push(await stablePixels(VIEW, 40));
    }
    // Ray jitter differs on a few percent of pixels; an unfit preset on most.
    expect(differingFraction(rendered[0], rendered[1])).toBeLessThan(0.05);
  });

  it('refits a streamed MR series to its loaded intensities', async () => {
    // A bright first slice under 1% of the voxels widens the data range far
    // beyond the fitted range.
    const open = async (name: string) => {
      const manifest = `${name}.json`;
      await writeManifestToFile(
        {
          resources: writeDicomSeries(makeTempDir(name), 'MR', 120, (index) =>
            index ? 100 + 5 * index : 30000
          ),
        },
        manifest
      );
      await openWith3DLayout(`tmp/${manifest}`, name);
      await expectVisibleVolume(name);
    };

    // Choosing the preset again fits it to the loaded image's statistics.
    await open('fitted-mr-reference');
    await expectSelectedPreset('MR Default');
    await $('.thumbnail-container*=Grayscale').click();
    await expect(selectedPreset()).toHaveText('Grayscale');
    await $('.thumbnail-container*=MR Default').click();
    await expect(selectedPreset()).toHaveText('MR Default');
    await showColorPresets(false);
    const fitted = await stablePixels(VIEW, 40);

    await open('fitted-mr-streamed');
    // Ray jitter differs on a few percent of pixels; an unfit range on far more.
    await browser.waitUntil(
      async () => differingFraction(fitted, await stablePixels(VIEW, 40)) < 0.1,
      { timeoutMsg: 'Expected the streamed series to match a fresh fit' }
    );
  });
});
