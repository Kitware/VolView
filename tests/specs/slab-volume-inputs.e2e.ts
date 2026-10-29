import fs from 'node:fs';
import path from 'node:path';
import { setReferenceLinesEnabled } from './referenceLinesTestUtils';
import { projectionGrayscaleDistribution } from './slabSamplingTestUtils';
import {
  CINE_US_DATASET,
  MRA_HEAD_NECK_DATASET,
  PROSTATEX_DATASET,
} from '../datasets';
import { volViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom } from './syntheticDicom';
import { makeTempDir, useCachedSample, writeManifestToFile } from './utils';
import {
  chooseEnFaceProjection,
  enFaceAppearance,
  expandEnFaceSection,
  expectEnFaceUnavailable,
  selectEnFace,
  setEnFaceWindow,
  setSlabRange,
  waitForEnFaceReady,
} from './octTestUtils';

const STEM = 'slab-volume-inputs';

async function expectVisibleVolume() {
  await browser.waitUntil(async () => {
    const { count, low, high } = await projectionGrayscaleDistribution();
    return count > 1000 && high - low > 10;
  });
  return (await enFaceAppearance()).image;
}

async function expectMethodChangesImage() {
  await waitForEnFaceReady();
  const meanImage = await expectVisibleVolume();
  await chooseEnFaceProjection('oct-projection-method', 'Maximum');
  await waitForEnFaceReady();
  await expectVisibleVolume();
  expect((await enFaceAppearance()).image).not.toBe(meanImage);
  expect(await volViewPage.getNotificationsCount()).toBe(0);
}

function stageColorVolume() {
  const values = Array.from({ length: 64 }, () => '200 30 20').join(' ');
  fs.writeFileSync(
    path.join(makeTempDir(STEM), 'color.vti'),
    '<VTKFile type="ImageData" version="1.0" byte_order="LittleEndian">' +
      '<ImageData WholeExtent="0 3 0 3 0 3" Origin="0 0 0" Spacing="1 1 1">' +
      '<Piece Extent="0 3 0 3 0 3"><PointData Scalars="color">' +
      '<DataArray type="UInt8" Name="color" NumberOfComponents="3" format="ascii">' +
      values +
      '</DataArray></PointData><CellData/></Piece></ImageData></VTKFile>'
  );
  return `${STEM}/color.vti`;
}

describe('Scalar volume projection inputs', () => {
  before(async () => {
    await volViewPage.open();
    await setReferenceLinesEnabled(true);
  });
  after(async () => setReferenceLinesEnabled(false));

  before(async () => {
    await useCachedSample(PROSTATEX_DATASET);
    await useCachedSample(MRA_HEAD_NECK_DATASET);
    await writeManifestToFile(
      {
        layouts: {
          'Volume projection': {
            direction: 'row',
            items: [{ type: 'EnFace', name: 'Saved projection' }],
          },
        },
      },
      `${STEM}.json`
    );
  });

  it('projects the MRA sample slab despite rounded DICOM direction cosines', async () => {
    await volViewPage.open(`?urls=[tmp/${STEM}.json]`);
    await volViewPage.samplesList.$('div[title="MRA Head and Neck"]').click();
    await waitForEnFaceReady();
    await chooseEnFaceProjection('oct-projection-axis', 'Axial');
    await setEnFaceWindow(128, 64);
    await $('[data-testid="oct-en-face-controls"]').click();
    await expandEnFaceSection('projection');
    await setSlabRange(10, 60);
    await browser.keys('Escape');
    await expectMethodChangesImage();
  });

  it('projects the oblique MRI PROSTATEx sample with source intensities', async () => {
    await volViewPage.open();
    await volViewPage.downloadProstateSample();
    await volViewPage.waitForViews();
    await selectEnFace(3);
    await waitForEnFaceReady();
    await chooseEnFaceProjection('oct-projection-axis', 'Axial');
    await setEnFaceWindow(1200, 549);
    await expectMethodChangesImage();
  });

  it('keeps a single DICOM image unavailable with a dimensionality reason', async () => {
    fs.writeFileSync(
      path.join(makeTempDir(STEM), 'single.dcm'),
      buildSyntheticDicom({
        studyUid: '1.2.3.1',
        seriesUid: '1.2.3.2',
        sopUid: '1.2.3.3',
        instanceNumber: 1,
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        imagePositionPatient: [0, 0, 0],
        pixelValue: 100,
      })
    );
    await volViewPage.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/single.dcm]`);
    await expectEnFaceUnavailable('three-dimensional volume');
  });

  it('keeps a three-component volume unavailable with a grayscale reason', async () => {
    await volViewPage.open(
      `?urls=[tmp/${STEM}.json,tmp/${stageColorVolume()}]`
    );
    await expectEnFaceUnavailable('grayscale volume');
    await expect($('.view-type-select input')).toHaveValue('En face');
  });

  it('keeps a temporal cine unavailable as a spatial projection', async () => {
    await volViewPage.open(
      `?urls=[tmp/${STEM}.json,tmp/${CINE_US_DATASET.name}]`
    );
    await expectEnFaceUnavailable('three-dimensional volume');
  });
});
