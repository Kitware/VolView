import fs from 'node:fs';
import path from 'node:path';
import { volViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import {
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

const nrrd = (fields: string[]) =>
  [
    'NRRD0005',
    'type: uchar',
    'dimension: 3',
    'sizes: 8 8 8',
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

function writeDicomSeries(directory: string, modality: string) {
  const studyUid = newUid();
  const seriesUid = newUid();
  return Array.from({ length: 4 }, (_, index) => {
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
        pixelValue: 100 * (index + 1),
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
    { file: 'undeclared.nrrd', header: nrrd([]), label: 'CT AAA' },
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
});
