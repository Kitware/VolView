import fs from 'node:fs';
import path from 'node:path';
import { test, expect, useReferenceLines } from '../fixtures';
import {
  CINE_US_DATASET,
  MRA_HEAD_NECK_DATASET,
  PROSTATEX_DATASET,
} from '../datasets';
import type { VolViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom } from './syntheticDicom';
import type { Utils } from './utils';
import type { OctUtils } from './octTestUtils';
import type { SlabSamplingUtils } from './slabSamplingTestUtils';
import { createVtiVolume } from '../fixtures/oct/volumes';

const STEM = 'slab-volume-inputs';

type Helpers = {
  volview: VolViewPage;
  oct: OctUtils;
  slabSampling: SlabSamplingUtils;
};

async function expectVisibleVolume({ oct, slabSampling }: Helpers) {
  await expect
    .poll(async () => {
      const { count, low, high } =
        await slabSampling.projectionGrayscaleDistribution();
      return count > 1000 && high - low > 10;
    })
    .toBe(true);
  return (await oct.enFaceAppearance()).image;
}

async function expectMethodChangesImage(helpers: Helpers) {
  const { volview, oct } = helpers;
  await oct.waitForEnFaceReady();
  const meanImage = await expectVisibleVolume(helpers);
  await oct.chooseEnFaceProjection('enface-projection-method', 'Maximum');
  await oct.waitForEnFaceReady();
  await expectVisibleVolume(helpers);
  expect((await oct.enFaceAppearance()).image).not.toBe(meanImage);
  expect(await volview.getNotificationsCount()).toBe(0);
}

function stageColorVolume(utils: Utils) {
  fs.writeFileSync(
    path.join(utils.makeTempDir(STEM), 'color.vti'),
    createVtiVolume({
      dimensions: [4, 4, 4],
      type: 'UInt8',
      name: 'color',
      components: 3,
      values: Array.from({ length: 64 }, () => [200, 30, 20]).flat(),
    })
  );
  return `${STEM}/color.vti`;
}

test.describe('Scalar volume projection inputs', () => {
  test.beforeEach(async ({ utils }) => {
    await utils.useCachedSample(PROSTATEX_DATASET);
    await utils.useCachedSample(MRA_HEAD_NECK_DATASET);
    await utils.writeManifestToFile(
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

  useReferenceLines();

  test('projects the MRA sample slab despite rounded DICOM direction cosines', async ({
    volview,
    oct,
    slabSampling,
  }) => {
    await volview.open(`?urls=[tmp/${STEM}.json]`);
    await volview.samplesList.locator('div[title="MRA Head and Neck"]').click();
    await oct.waitForEnFaceReady();
    await oct.chooseEnFaceProjection('enface-projection-axis', 'Axial');
    await oct.setEnFaceWindow(128, 64);
    await oct.setEnFaceSlab(10, 60);
    await expectMethodChangesImage({ volview, oct, slabSampling });
  });

  test('projects the oblique MRI PROSTATEx sample with source intensities', async ({
    volview,
    oct,
    slabSampling,
  }) => {
    await volview.open();
    await volview.downloadProstateSample();
    await volview.waitForViews();
    await oct.selectEnFace(3);
    await oct.waitForEnFaceReady();
    await oct.chooseEnFaceProjection('enface-projection-axis', 'Axial');
    await oct.setEnFaceWindow(1200, 549);
    await expectMethodChangesImage({ volview, oct, slabSampling });
  });

  test('keeps a single DICOM image unavailable with a dimensionality reason', async ({
    volview,
    utils,
    oct,
  }) => {
    fs.writeFileSync(
      path.join(utils.makeTempDir(STEM), 'single.dcm'),
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
    await volview.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/single.dcm]`);
    await oct.expectEnFaceUnavailable('three-dimensional volume');
  });

  test('keeps a three-component volume unavailable with a grayscale reason', async ({
    page,
    volview,
    utils,
    oct,
  }) => {
    await volview.open(
      `?urls=[tmp/${STEM}.json,tmp/${stageColorVolume(utils)}]`
    );
    await oct.expectEnFaceUnavailable('grayscale volume');
    await expect(page.locator('.view-type-select input')).toHaveValue(
      'Saved projection'
    );
  });

  test('keeps a temporal cine unavailable as a spatial projection', async ({
    volview,
    oct,
  }) => {
    await volview.open(`?urls=[tmp/${STEM}.json,tmp/${CINE_US_DATASET.name}]`);
    await oct.expectEnFaceUnavailable('three-dimensional volume');
  });
});
