import fs from 'node:fs';
import path from 'node:path';
import { createNrrdVolume } from '../fixtures/oct/volumes';
import { volViewPage } from '../pageobjects/volview.page';
import { waitForEnFaceReady, VIEWER, toolButton } from './octTestUtils';
import { setReferenceLinesEnabled } from './referenceLinesTestUtils';
import {
  makeTempDir,
  waitForModuleTransitions,
  writeManifestToFile,
} from './utils';

const STEM = 'slab-reference-visibility';
const SOURCE = 'div[data-testid~="vtk-two-view"]';
async function expectReferenceLines(visible: boolean) {
  const lines = [
    $(VIEWER).$('[data-testid="enface-slice-lines"] line'),
    $(SOURCE).$('[data-testid="reference-lines"] line'),
  ];
  for (const line of lines) {
    if (visible) await expect(line).toBeDisplayed();
    else await expect(line).not.toExist();
  }
}

describe('Slab reference-line visibility', () => {
  after(async () => setReferenceLinesEnabled(false));

  it('shares the setting and Crosshairs override with source slices, including a hidden base image', async () => {
    fs.writeFileSync(
      path.join(makeTempDir(STEM), 'source.nrrd'),
      createNrrdVolume({
        dimensions: [8, 7, 6],
        spacing: [1, 1, 1],
        scalars: Uint16Array.from({ length: 8 * 7 * 6 }, (_, index) => index),
      })
    );
    await writeManifestToFile(
      { layouts: { Visibility: [['axial', 'coronal'], ['enface']] } },
      STEM + '.json'
    );
    await volViewPage.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/source.nrrd]`);
    await waitForEnFaceReady();
    await $(VIEWER).$('canvas').click();
    await toolButton('Pan').click();
    await setReferenceLinesEnabled(false);
    await expectReferenceLines(false);

    await setReferenceLinesEnabled(true);
    await expectReferenceLines(true);

    await volViewPage.renderingModuleTab.click();
    await waitForModuleTransitions();
    await $('[data-testid="base-image-visibility"]').click();
    await waitForEnFaceReady();
    await expectReferenceLines(true);

    await setReferenceLinesEnabled(false);
    await expectReferenceLines(false);
    await $(SOURCE).$('canvas').click();
    await toolButton('Crosshairs').click();
    await expectReferenceLines(true);
    await toolButton('Pan').click();
    await expectReferenceLines(false);
  });
});
