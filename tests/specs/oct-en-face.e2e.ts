import fs from 'node:fs';
import path from 'node:path';
import { Key } from 'webdriverio';
import {
  waitForEnFaceReady,
  expectEnFaceDisabledInSwitcher,
  setSlabRange,
  setEnFaceWindow,
  slabThumb,
  selectEnFace,
  CANVAS,
  CONTROLS,
  PANEL,
  WINDOW_TOOL,
  openEnFaceProjection,
  openEnFaceControls,
  selectSetting,
} from './octTestUtils';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  makeTempDir,
  openVolViewPage,
  openThroughDialog,
  waitForModuleTransitions,
} from './utils';
import { selectBasePalette } from './layerDisplayTestUtils';
import { deflatedExplicitVR, nonOCTDicom } from '../fixtures/oct/volumes';
import { createSyntheticOCT } from '../fixtures/oct/dicom';
import { paddedSyntheticOCT } from '../fixtures/oct/padding';
import {
  reference,
  STEM,
  stageFixture,
  expectProjectionPixel,
  expectCalibratedEnFace,
  openRetina,
  registerOctTestHooks,
} from './octInteractionTestUtils';

describe('Retinal OCT en-face', () => {
  registerOctTestHooks();
  it('keeps both stacked views visible when double-clicking rendering controls and the view selector', async () => {
    await browser.setViewport({
      width: 1400,
      height: 1000,
      devicePixelRatio: 1,
    });
    await openRetina(true, true);
    const source = (await volViewPage.getViews2D())[0];
    const expectBothViews = async () => {
      await expect(source.$('canvas')).toBeDisplayed();
      await expect($(CANVAS)).toBeDisplayed();
    };
    await $(CONTROLS).doubleClick();
    await expectBothViews();
    await openEnFaceProjection();
    await slabThumb('start').doubleClick();
    await expectBothViews();
    await browser.keys('Escape');
    await $(
      '[data-testid="enface-viewer"] .view-type-select .v-field'
    ).doubleClick();
    await browser.keys('Escape');
    await expectBothViews();
  });

  it('changes projection, slab, axis and windowing through compact controls', async () => {
    await browser.setViewport({
      width: 1280,
      height: 400,
      devicePixelRatio: 1,
    });
    await openRetina();
    expect(await $(WINDOW_TOOL).isEnabled()).toBe(true);
    const compactPanel = await $(PANEL).getSize();
    expect(compactPanel.width).toBe(300);
    expect(compactPanel.height).toBeGreaterThan(0);
    expect(compactPanel.height).toBeLessThanOrEqual(320);
    const contained = await $(PANEL).execute((panel) => {
      const bounds = panel.getBoundingClientRect();
      return (
        bounds.left >= 0 &&
        bounds.top >= 0 &&
        bounds.right <= window.innerWidth &&
        bounds.bottom <= window.innerHeight
      );
    });
    expect(contained).toBe(true);
    await expect(
      $(PANEL).$('[data-testid="enface-projection-toggle"]')
    ).toHaveAttribute('aria-expanded', 'true');
    await setEnFaceWindow(1000, 500);
    // The standard physical slab has mean 317, maximum 538 and sampled sum 140431.
    await expectProjectionPixel(81);
    await openEnFaceProjection();
    await selectSetting('enface-projection-method', 'Maximum');
    await waitForEnFaceReady();
    await expect(
      $('.v-overlay--active [data-testid="enface-projection-method"] input')
    ).toHaveValue('Maximum');
    await setEnFaceWindow(1000, 500);
    await expectProjectionPixel(137);
    await openEnFaceControls();
    await selectSetting('enface-projection-method', 'Sum');
    await waitForEnFaceReady();
    await expect(
      $('.v-overlay--active [data-testid="enface-projection-method"] input')
    ).toHaveValue('Sum');
    await setEnFaceWindow(200000, 100000);
    await expectProjectionPixel(179);
    await openEnFaceControls();
    await selectSetting('enface-projection-method', 'Mean');
    await setEnFaceWindow(1000, 500);
    await openEnFaceControls();
    await setSlabRange(reference.slab.start, reference.slab.end);
    await waitForEnFaceReady();
    await expectProjectionPixel(76);
    await browser.keys('Escape');
    await openEnFaceProjection();
    await selectSetting('enface-projection-axis', 'Sagittal');
    await waitForEnFaceReady();
    await expect(
      $('.v-overlay--active [data-testid="enface-projection-axis"] input')
    ).toHaveValue('Sagittal');
    await expect(slabThumb('start')).toHaveAttribute('aria-valuenow', '0');
    await expect(slabThumb('end')).toHaveAttribute('aria-valuenow', '127');
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('shows slab values only during interaction and applies a drag on release', async () => {
    await openRetina(true);
    await waitForEnFaceReady();
    const labels = $$(
      '.v-overlay--active [data-testid="enface-slab-range"] .v-slider-thumb__label'
    );
    expect(await labels.length).toBe(2);
    for (const label of await labels) await expect(label).not.toBeDisplayed();
    await setEnFaceWindow(1000, 500);
    await expectProjectionPixel(81);
    await openEnFaceControls();
    const start = slabThumb('start');
    const end = slabThumb('end');
    await start.scrollIntoView({ block: 'center', inline: 'nearest' });
    await start.waitForStable();
    const startBounds = await start.getLocation();
    const startSize = await start.getSize();
    const endBounds = await end.getLocation();
    const endSize = await end.getSize();
    const startX = Math.round(startBounds.x + startSize.width / 2);
    const endX = Math.round(endBounds.x + endSize.width / 2);
    const y = Math.round(startBounds.y + startSize.height / 2);
    let draggedStart = 0;
    try {
      await browser
        .action('pointer', { id: 'oct-slab-drag' })
        .move({ x: startX, y })
        .down()
        .move({ x: Math.round((startX + endX) / 2), y })
        .perform(true);
      await expect(start).not.toHaveAttribute('aria-valuenow', '0');
      draggedStart = Number(await start.getAttribute('aria-valuenow'));
      expect(draggedStart).toBeGreaterThan(90);
      expect(draggedStart).toBeLessThan(130);
      await expect(start.$('.v-slider-thumb__label')).toBeDisplayed();
      await expectProjectionPixel(81);
    } finally {
      await browser.action('pointer', { id: 'oct-slab-drag' }).up().perform();
    }
    await waitForEnFaceReady();
    await expectProjectionPixel(
      Math.round(((317 + draggedStart) * 255) / 1000)
    );
    await browser.keys(Key.Home);
    await expect(start).toHaveAttribute('aria-valuenow', '0');
    await expectProjectionPixel(81);
  });

  it('uses temporary Crosshairs in En face and restores the previous allowed tool', async () => {
    await openRetina(false, true);
    await browser.keys('Escape');
    await $(CANVAS).click();
    const pan = $('button[data-testid^="control-button-Pan "]');
    const crosshairs = $('button[data-testid^="control-button-Crosshairs "]');
    const select = $('button[data-testid^="control-button-Select "]');
    const ruler = $('button[data-testid^="control-button-Ruler "]');
    const keyboard = () =>
      browser.action('key', { id: 'oct-crosshairs-shortcut' });
    const hold = () => keyboard().down(Key.Shift).down('c').perform(true);
    const release = () => keyboard().up('c').up(Key.Shift).perform(true);

    await pan.click();
    await expect(pan).toHaveElementClass('tool-btn-selected');
    await expect(crosshairs).toBeEnabled();
    try {
      await hold();
      await expect(crosshairs).toHaveElementClass('tool-btn-selected');
      await release();
      await expect(pan).toHaveElementClass('tool-btn-selected');

      await volViewPage.focusFirst2DView();
      await expect(crosshairs).toBeEnabled();
      await hold();
      await expect(crosshairs).toHaveElementClass('tool-btn-selected');
      await release();
      await expect(pan).toHaveElementClass('tool-btn-selected');

      await ruler.click();
      await expect(ruler).toHaveElementClass('tool-btn-selected');
      await hold();
      await expect(crosshairs).toHaveElementClass('tool-btn-selected');
      await $(CANVAS).click();
      await expect(crosshairs).toHaveElementClass('tool-btn-selected');
      await expect(crosshairs).toBeEnabled();
      await release();
      await expect(select).toHaveElementClass('tool-btn-selected');
    } finally {
      await browser.releaseActions();
    }
  });

  it('renders declared padding through the standard image contrast and palette', async () => {
    const name = STEM + '/retina-padding.dcm';
    const padded = paddedSyntheticOCT(createSyntheticOCT());
    fs.writeFileSync(
      path.join(makeTempDir(STEM), 'retina-padding.dcm'),
      padded.bytes
    );
    await openVolViewPage(name);
    await selectEnFace();
    await setEnFaceWindow(1000, 500);
    await expectCalibratedEnFace();
    await expectProjectionPixel(255, 5, 12);
    await expectProjectionPixel(81, 60, 12);
    await $(CANVAS).click();
    await volViewPage.renderingModuleTab.click();
    await waitForModuleTransitions();
    await selectBasePalette('Inverted grayscale');
    await waitForEnFaceReady();
    await expectProjectionPixel(0, 5, 12);
    await expectProjectionPixel(174, 60, 12);
    await selectBasePalette('Grayscale');
    await waitForEnFaceReady();
    await expectProjectionPixel(255, 5, 12);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('imports deflated OCT through the file dialog with calibrated geometry and padding', async () => {
    const directory = makeTempDir(STEM);
    const file = path.join(directory, 'retina-padding-deflated.dcm');
    const padded = paddedSyntheticOCT(createSyntheticOCT());
    fs.writeFileSync(file, deflatedExplicitVR(padded.bytes));
    await volViewPage.open();
    await openThroughDialog(file);
    await volViewPage.waitForViews();
    await selectEnFace();
    await setEnFaceWindow(1000, 500);
    await expectCalibratedEnFace();
    await expectProjectionPixel(255, 5, 12);
    await expectProjectionPixel(81, 60, 12);
  });

  it('projects a complete grayscale non-ophthalmic DICOM volume with standard contrast', async () => {
    const image = STEM + '/ordinary-volume.dcm';
    fs.writeFileSync(
      path.join(makeTempDir(STEM), 'ordinary-volume.dcm'),
      nonOCTDicom(createSyntheticOCT())
    );
    await openVolViewPage(image);
    await selectEnFace();
    await waitForEnFaceReady();
    await setEnFaceWindow(1000, 500);
    await expectProjectionPixel(81);
    await openEnFaceControls();
    await selectSetting('enface-projection-method', 'Maximum');
    await browser.keys('Escape');
    await waitForEnFaceReady();
    await setEnFaceWindow(1000, 500);
    await expectProjectionPixel(137);
    await expect($(WINDOW_TOOL)).toBeEnabled();
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('declines an OCT radial acquisition that requires spatial reconstruction', async () => {
    const source = stageFixture('synthetic-oct.dcm');
    const raw = fs.readFileSync(path.join(TEMP_DIR, source));
    const scanPatternOffset = raw.indexOf(Buffer.from('128280'));
    expect(scanPatternOffset).toBeGreaterThan(0);
    Buffer.from('128282').copy(raw, scanPatternOffset);
    const file = STEM + '/synthetic-oct-radial.dcm';
    fs.writeFileSync(path.join(TEMP_DIR, file), raw);
    await openVolViewPage(file);
    await expectEnFaceDisabledInSwitcher('spatial reconstruction');
  });
});
