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

const LAYOUT = {
  layouts: {
    default: {
      direction: 'row',
      items: [{ type: '3D', viewDirection: 'Superior', viewUp: 'Anterior' }],
    },
  },
};

const VOXELS = Buffer.from(
  Array.from({ length: 512 }, (_, index) => index % 256)
);

const nrrd = (fields: string[], type = 'uchar', size = 8) =>
  [
    'NRRD0005',
    `type: ${type}`,
    'dimension: 3',
    `sizes: ${size} ${size} ${size}`,
    'endian: little',
    'space: left-posterior-superior',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: raw',
    ...fields,
    '',
    '',
  ].join('\n');

const mha = (fields: string[]) =>
  [
    'ObjectType = Image',
    'NDims = 3',
    'DimSize = 8 8 8',
    ...fields,
    'ElementType = MET_UCHAR',
    'ElementDataFile = LOCAL',
    '',
  ].join('\n');

function floatVoxels(size: number, valueAt: (index: number) => number) {
  const buffer = Buffer.alloc(size ** 3 * 4);
  for (let index = 0; index < size ** 3; index++)
    buffer.writeFloatLE(valueAt(index), index * 4);
  return buffer;
}

function writeNrrd(name: string, header: string, voxels: Buffer) {
  const directory = makeTempDir(name);
  fs.writeFileSync(
    path.join(directory, `${name}.nrrd`),
    Buffer.concat([Buffer.from(header), voxels])
  );
  return `tmp/${name}/${name}.nrrd`;
}

const sliceValue = (index: number) => 100 * (index + 1);

function writeDicomSeries(directory: string, modality: string, slices = 4) {
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
        pixelValue: sliceValue(index),
      })
    );
    return { url: `tmp/${path.basename(directory)}/${name}`, name };
  });
}

async function openWith3DLayout(dataUrl: string, name: string) {
  const config = `${name}-layout.json`;
  await writeManifestToFile(LAYOUT, config);
  await volViewPage.open(`?urls=[tmp/${config},${dataUrl}]`);
  await volViewPage.waitForViewCounts(0, true);
}

async function expectSelectedPreset(label: string) {
  await volViewPage.renderingModuleTab.waitForClickable();
  await volViewPage.renderingModuleTab.click();
  await waitForModuleTransitions();
  const title = $('.v-expansion-panel-title*=Color Presets');
  await title.scrollIntoView({ block: 'center', behavior: 'instant' });
  if ((await title.getAttribute('aria-expanded')) !== 'true') {
    await title.click();
  }
  await expect($('.thumbnail-container.bg-blue')).toHaveText(label);
}

describe('volume preset from declared modality', () => {
  for (const { file, header, label } of [
    { file: 'mr.nrrd', header: nrrd(['modality:=MR']), label: 'MR Default' },
    { file: 'us.nrrd', header: nrrd(['0008|0060:=US']), label: 'US Fetal' },
    { file: 'undeclared.nrrd', header: nrrd([]), label: 'Grayscale' },
    {
      file: 'mr.mha',
      header: mha(['Modality = MET_MOD_MR']),
      label: 'MR Default',
    },
  ]) {
    it(`selects ${label} for ${file}`, async () => {
      const name = `modality-preset-${file.replace('.', '-')}`;
      const directory = makeTempDir(name);
      fs.writeFileSync(
        path.join(directory, file),
        Buffer.concat([Buffer.from(header), VOXELS])
      );
      await openWith3DLayout(`tmp/${name}/${file}`, name);
      await expectSelectedPreset(label);
    });
  }

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

  it('guesses CT AAA for a streamed DICOM series of an unlisted modality', async () => {
    const name = 'dicom-pt-preset';
    const directory = makeTempDir(name);
    const manifest = `${name}.json`;
    await writeManifestToFile(
      { resources: writeDicomSeries(directory, 'PT') },
      manifest
    );
    await openWith3DLayout(`tmp/${manifest}`, name);
    await expectVisibleVolume(name);
    await expectSelectedPreset('CT AAA');
  });
});

// The inset keeps only the view center, where every test volume has signal.
const CENTER_INSET = 280;

async function brightCenterPixels(name: string, inset: number, level = 40) {
  const [{ data }] = await captureViewPixels(
    '[data-testid~="vtk-volume-view"]',
    inset,
    `${name}.png`
  );
  let bright = 0;
  for (let index = 0; index < data.length; index += 4)
    if (Math.max(data[index], data[index + 1], data[index + 2]) > level)
      bright++;
  return { bright, fraction: bright / (data.length / 4) };
}

/** Fraction of RGBA pixels whose largest channel difference exceeds 8. */
function differingFraction(a: Buffer, b: Buffer) {
  let differing = 0;
  for (let index = 0; index < a.length; index += 4) {
    const delta = Math.max(
      Math.abs(a[index] - b[index]),
      Math.abs(a[index + 1] - b[index + 1]),
      Math.abs(a[index + 2] - b[index + 2])
    );
    if (delta > 8) differing++;
  }
  return differing / (a.length / 4);
}

/** Captures the 3D view until two consecutive frames match. */
async function stableViewPixels() {
  const capture = async () =>
    (
      await captureViewPixels(
        '[data-testid~="vtk-volume-view"]',
        40,
        'stable-view.png'
      )
    )[0].data;
  let previous = await capture();
  await browser.waitUntil(async () => {
    const next = await capture();
    const same = next.equals(previous);
    previous = next;
    return same;
  });
  return previous;
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

  it('replaces a CT preset that is transparent over normalized data', async () => {
    const name = 'fitted-normalized-ct';
    const voxels = floatVoxels(SIZE, (index) => {
      const [x, y, z] = coordinates(index).map((c) => c - SIZE / 2);
      return Math.max(0, 1 - Math.hypot(x, y, z) / (SIZE / 3));
    });
    await openWith3DLayout(
      writeNrrd(name, nrrd(['modality:=CT'], 'float', SIZE), voxels),
      name
    );
    await expectVisibleVolume(name);
    await expectSelectedPreset('Grayscale');
  });

  it('fits an MR preset to the intensity scale', async () => {
    const shell = (scale: number) => (index: number) => {
      const radius = Math.hypot(...coordinates(index).map((c) => c - SIZE / 2));
      if (radius < SIZE / 8) return 300 * scale;
      return radius < (3 * SIZE) / 8 ? 100 * scale : 0;
    };
    const rendered = [];
    for (const scale of [1, 10]) {
      const name = `fitted-mr-x${scale}`;
      await openWith3DLayout(
        writeNrrd(
          name,
          nrrd(['modality:=MR'], 'float', SIZE),
          floatVoxels(SIZE, shell(scale))
        ),
        name
      );
      await expectVisibleVolume(name);
      rendered.push(await stableViewPixels());
    }
    expect(differingFraction(rendered[0], rendered[1])).toBeLessThan(0.01);
  });

  it('refits a streamed MR series to its loaded intensities', async () => {
    const name = 'fitted-mr-dicom';
    const manifest = `${name}.json`;
    await writeManifestToFile(
      { resources: writeDicomSeries(makeTempDir(name), 'MR', 8) },
      manifest
    );
    await openWith3DLayout(`tmp/${manifest}`, name);
    await volViewPage.waitForLoadingIndicator(
      $('[data-testid~="vtk-volume-view"]')
    );
    await expectVisibleVolume(name);
    const streamed = await stableViewPixels();

    const loadedName = 'fitted-mr-nrrd';
    const voxels = Buffer.alloc(2 * 8 ** 3);
    for (let index = 0; index < 8 ** 3; index++)
      voxels.writeUInt16LE(sliceValue(Math.floor(index / 64)), 2 * index);
    await openWith3DLayout(
      writeNrrd(loadedName, nrrd(['modality:=MR'], 'ushort'), voxels),
      loadedName
    );
    await expectVisibleVolume(loadedName);
    // Ray jitter differs between sources on ~8%; a range left unfit differs on ~45%.
    expect(differingFraction(streamed, await stableViewPixels())).toBeLessThan(
      0.2
    );
  });
});
