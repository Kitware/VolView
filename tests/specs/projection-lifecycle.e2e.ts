import fs from 'node:fs';
import path from 'node:path';
import { useReferenceLines } from './referenceLinesTestUtils';
import { createSyntheticOCT } from '../fixtures/oct/dicom';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { makeTempDir, writeManifestToFile, overlayOption } from './utils';
import {
  canvasAppearance,
  chooseEnFaceProjection,
  displayedWindow,
  getEnFaceWindow,
  projectionTransform,
  setSlabRange,
  setEnFaceWindow,
  waitForEnFaceReady,
  CANVAS,
  VIEWER,
  WINDOW_TOOL,
  openEnFaceProjection,
} from './octTestUtils';
import { expectProjectionPixel } from './octInteractionTestUtils';

const SOURCE = 'div[data-testid~="vtk-two-view"]';

async function fingerprint(selector: string) {
  return canvasAppearance(await $(selector).getElement());
}

async function selectView(label: string, view: WebdriverIO.Element) {
  await view.$('.view-type-select .v-field').click();
  const option = overlayOption(label);
  await option.waitForClickable();
  await option.click();
}

describe('Projection lifecycle', () => {
  useReferenceLines();

  it('shows the latest method and slab, preserves source peers, and remounts current settings', async () => {
    const directory = makeTempDir('projection-lifecycle');
    fs.writeFileSync(path.join(directory, 'retina.dcm'), createSyntheticOCT());
    await writeManifestToFile(
      { layouts: { 'Projection lifecycle': [['axial'], ['enface']] } },
      'projection-lifecycle.json'
    );
    await volViewPage.open(
      '?urls=[tmp/projection-lifecycle.json,tmp/projection-lifecycle/retina.dcm]'
    );
    await volViewPage.waitForViews();
    await waitForEnFaceReady();
    await browser.waitUntil(
      async () => (await fingerprint(SOURCE + ' canvas')).visiblePixels > 100
    );
    const sourcePixels = await fingerprint(SOURCE + ' canvas');
    const sourceWindow = await displayedWindow(await $(SOURCE).getElement());

    await $(CANVAS).click();
    await $(WINDOW_TOOL).click();
    const inputs = $$('.v-overlay--active .manual-inputs input');
    await inputs[0].waitForDisplayed();
    await inputs[0].waitForStable();
    await setValueVueInput(inputs[0], '1000');
    await setValueVueInput(inputs[1], '500');
    await browser.keys('Escape');
    await inputs[0].waitForDisplayed({ reverse: true });
    await expectProjectionPixel(81);
    const geometry = await projectionTransform();

    for (const method of ['Maximum', 'Sum', 'Mean', 'Maximum', 'Mean'])
      await chooseEnFaceProjection('enface-projection-method', method);
    await waitForEnFaceReady();
    expect(await getEnFaceWindow()).toEqual({ width: 192, level: 331 });
    await expectProjectionPixel(109);
    await setEnFaceWindow(1000, 500);
    await openEnFaceProjection();
    for (const [first, last] of [
      [10, 50],
      [100, 103],
      [100, 100],
    ])
      await setSlabRange(first, last);
    await browser.keys('Escape');
    await waitForEnFaceReady();
    await expectProjectionPixel(75);
    expect(await projectionTransform()).toEqual(geometry);
    expect(await displayedWindow(await $(SOURCE).getElement())).toEqual(
      sourceWindow
    );
    expect(await fingerprint(SOURCE + ' canvas')).toEqual(sourcePixels);

    const sourceCanvas = () => $(SOURCE + ' canvas');
    await sourceCanvas().doubleClick();
    await expect($(VIEWER)).not.toExist();
    await sourceCanvas().waitForStable();
    await sourceCanvas().doubleClick();
    await waitForEnFaceReady();
    await expectProjectionPixel(75);
    expect(await projectionTransform()).toEqual(geometry);

    await selectView('Axial', await $(VIEWER).getElement());
    await expect($(VIEWER)).not.toExist();
    const peers = await $$(SOURCE).map((view) => view.getElement());
    await selectView('En face', peers[1]);
    await waitForEnFaceReady();
    await setEnFaceWindow(1000, 500);
    await expectProjectionPixel(81);
    expect(await displayedWindow(await $(SOURCE).getElement())).toEqual(
      sourceWindow
    );
    expect(await fingerprint(SOURCE + ' canvas')).toEqual(sourcePixels);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
