import fs from 'node:fs';
import path from 'node:path';
import { test, expect, registerOctTestHooks } from '../fixtures';
import { waitForTransitions } from '../pageobjects/volview.page';
import { CANVAS, CONTROLS, PANEL, WINDOW_TOOL } from './octTestUtils';
import { deflatedExplicitVR, nonOCTDicom } from '../fixtures/oct/volumes';
import { createSyntheticOCT } from '../fixtures/oct/dicom';
import { paddedSyntheticOCT } from '../fixtures/oct/padding';
import { reference, STEM } from './octInteractionTestUtils';

test.describe('Retinal OCT en-face', () => {
  registerOctTestHooks();
  test('keeps both stacked views visible when double-clicking rendering controls and the view selector', async ({
    page,
    volview,
    oct,
    octInteraction,
  }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await octInteraction.openRetina(true, true);
    const source = volview.views2D.first();
    const expectBothViews = async () => {
      await expect(source.locator('canvas')).toBeVisible();
      await expect(page.locator(CANVAS).first()).toBeVisible();
    };
    await page.locator(CONTROLS).first().dblclick();
    await expectBothViews();
    await oct.openEnFaceControls();
    await oct.setSegmentShown('Synthetic retinal layer', true);
    // The new threshold row grows the menu, which then repositions; a click
    // aimed before it settles lands on the view below.
    await waitForTransitions(oct.segmentThreshold('Synthetic retinal layer'));
    await oct.segmentThreshold('Synthetic retinal layer').dblclick();
    await expectBothViews();
    await oct.segmentThresholdSlider('Synthetic retinal layer').dblclick();
    await expectBothViews();
    await oct.expandEnFaceSection('projection');
    await oct.slabThumb('start').dblclick();
    await expectBothViews();
    await page.keyboard.press('Escape');
    await page
      .locator('[data-testid="enface-viewer"] .view-type-select .v-field')
      .first()
      .dblclick();
    await page.keyboard.press('Escape');
    await expectBothViews();
  });

  test('changes projection, slab, axis and windowing through compact controls', async ({
    page,
    volview,
    oct,
    octInteraction,
  }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await octInteraction.openRetina();
    expect(await page.locator(WINDOW_TOOL).isEnabled()).toBe(true);
    const panel = page.locator(PANEL);
    const compactPanel = await panel.boundingBox();
    expect(compactPanel?.width).toBe(450);
    expect(compactPanel?.height).toBeGreaterThan(0);
    expect(compactPanel?.height).toBeLessThanOrEqual(320);
    const contained = await panel.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.left >= 0 &&
        bounds.top >= 0 &&
        bounds.right <= window.innerWidth &&
        bounds.bottom <= window.innerHeight
      );
    });
    expect(contained).toBe(true);
    for (const section of ['projection', 'segments'])
      await expect(
        panel.locator('[data-testid="enface-' + section + '-toggle"]')
      ).toHaveAttribute('aria-expanded', 'true');
    await oct.setEnFaceWindow(1000, 500);
    // The standard physical slab has mean 317, maximum 538 and sampled sum 140431.
    await octInteraction.expectProjectionPixel(81);
    await oct.openEnFaceProjection();
    await oct.selectSetting('enface-projection-method', 'Maximum');
    await oct.waitForEnFaceReady();
    await expect(
      page.locator(
        '.v-overlay--active [data-testid="enface-projection-method"] input'
      )
    ).toHaveValue('Maximum');
    await oct.setEnFaceWindow(1000, 500);
    await octInteraction.expectProjectionPixel(137);
    await oct.openEnFaceControls();
    await oct.selectSetting('enface-projection-method', 'Sum');
    await oct.waitForEnFaceReady();
    await expect(
      page.locator(
        '.v-overlay--active [data-testid="enface-projection-method"] input'
      )
    ).toHaveValue('Sum');
    await oct.setEnFaceWindow(200000, 100000);
    await octInteraction.expectProjectionPixel(179);
    await oct.openEnFaceControls();
    await oct.selectSetting('enface-projection-method', 'Mean');
    await oct.setEnFaceWindow(1000, 500);
    await oct.openEnFaceControls();
    await oct.setSlabRange(reference.slab.start, reference.slab.end);
    await oct.waitForEnFaceReady();
    await octInteraction.expectProjectionPixel(76);
    await page.keyboard.press('Escape');
    await oct.openEnFaceProjection();
    await oct.selectSetting('enface-projection-axis', 'Sagittal');
    await oct.waitForEnFaceReady();
    await expect(
      page.locator(
        '.v-overlay--active [data-testid="enface-projection-axis"] input'
      )
    ).toHaveValue('Sagittal');
    await expect(oct.slabThumb('start')).toHaveAttribute('aria-valuenow', '0');
    await expect(oct.slabThumb('end')).toHaveAttribute('aria-valuenow', '127');
    await oct.expandEnFaceSection('segments');
    await expect(
      panel.locator('[data-testid="enface-segments-reason"]')
    ).toContainText('Load or create a segmentation mask');
    await expect(
      panel.locator('[data-testid="enface-segment-row"]')
    ).not.toBeAttached();
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('shows slab values only during interaction and applies a drag on release', async ({
    page,
    oct,
    octInteraction,
    segmentation,
  }) => {
    const band = 'Synthetic retinal band';
    await octInteraction.openRetina(true);
    await oct.waitForEnFaceReady();
    const labels = page.locator(
      '.v-overlay--active [data-testid="enface-slab-range"] .v-slider-thumb__label'
    );
    await expect(labels).toHaveCount(2);
    for (const label of await labels.all()) await expect(label).toBeHidden();
    await page.keyboard.press('Escape');
    await segmentation.setSegmentVisible('Alternative synthetic band', false);
    await oct.setEnFaceWindow(1000, 500);
    await oct.openEnFaceControls();
    const threshold = oct.segmentThresholdSlider(band);
    await oct.setSegmentShown(band, true);
    await expect(oct.segmentThreshold(band)).toBeEnabled();
    // A zero threshold draws no region, leaving the projection gray to sample.
    await oct.setSegmentThreshold(band, 0);
    await octInteraction.expectProjectionPixel(81);
    const thresholdMaximum = await threshold.getAttribute('aria-valuemax');
    expect(Number(thresholdMaximum)).toBeGreaterThan(1);
    const thresholdValue = await oct.segmentThreshold(band).inputValue();
    const start = oct.slabThumb('start');
    const end = oct.slabThumb('end');
    await start.evaluate((element) =>
      element.scrollIntoView({ block: 'center', inline: 'nearest' })
    );
    await waitForTransitions(start);
    const startBox = await start.boundingBox();
    const endBox = await end.boundingBox();
    if (!startBox || !endBox) throw new Error('The slab thumbs are off screen');
    const startX = Math.round(startBox.x + startBox.width / 2);
    const endX = Math.round(endBox.x + endBox.width / 2);
    const y = Math.round(startBox.y + startBox.height / 2);
    const readProjectionChanges =
      await octInteraction.observeSlabProjectionChanges();
    let draggedStart = 0;
    try {
      await page.mouse.move(startX, y);
      await page.mouse.down();
      await page.mouse.move(Math.round((startX + endX) / 2), y);
      await expect(start).not.toHaveAttribute('aria-valuenow', '0');
      draggedStart = Number(await start.getAttribute('aria-valuenow'));
      expect(draggedStart).toBeGreaterThan(reference.slab.end);
      expect(draggedStart).toBeLessThan(130);
      await expect(start.locator('.v-slider-thumb__label')).toBeVisible();
      await expect(threshold).toHaveAttribute(
        'aria-valuemax',
        thresholdMaximum!
      );
      await expect(oct.segmentThreshold(band)).toHaveValue(thresholdValue);
      await octInteraction.expectProjectionPixel(81);
      expect(await readProjectionChanges()).toEqual([]);
    } finally {
      await page.mouse.up();
      await readProjectionChanges();
    }
    await oct.waitForEnFaceReady();
    await octInteraction.expectProjectionPixel(
      Math.round(((317 + draggedStart) * 255) / 1000)
    );
    await expect(threshold).toHaveAttribute('aria-valuemax', '0.1');
    await expect(oct.segmentThreshold(band)).toHaveValue(thresholdValue);
    await page.keyboard.press('Home');
    await expect(start).toHaveAttribute('aria-valuenow', '0');
    await octInteraction.expectProjectionPixel(81);
  });

  test('uses temporary Crosshairs in En face and restores the previous allowed tool', async ({
    page,
    volview,
    oct,
    octInteraction,
  }) => {
    await octInteraction.openRetina(false, true);
    await page.keyboard.press('Escape');
    await page.locator(CANVAS).first().click();
    const pan = oct.toolButton('Pan');
    const crosshairs = oct.toolButton('Crosshairs');
    const ruler = oct.toolButton('Ruler');
    // Playwright does not shift a letter, so the shifted key is named.
    const hold = async () => {
      await page.keyboard.down('Shift');
      await page.keyboard.down('C');
    };
    const release = async () => {
      await page.keyboard.up('C');
      await page.keyboard.up('Shift');
    };
    const selected = /\btool-btn-selected\b/;

    await pan.click();
    await expect(pan).toHaveClass(selected);
    await expect(crosshairs).toBeEnabled();
    await hold();
    await expect(crosshairs).toHaveClass(selected);
    await release();
    await expect(pan).toHaveClass(selected);

    await volview.focusFirst2DView();
    await expect(crosshairs).toBeEnabled();
    await hold();
    await expect(crosshairs).toHaveClass(selected);
    await release();
    await expect(pan).toHaveClass(selected);

    await ruler.click();
    await expect(ruler).toHaveClass(selected);
    await hold();
    await expect(crosshairs).toHaveClass(selected);
    await page.locator(CANVAS).first().click();
    await expect(crosshairs).toHaveClass(selected);
    await expect(crosshairs).toBeEnabled();
    await release();
    await expect(ruler).toHaveClass(selected);
  });

  test('renders declared padding through the standard image contrast and palette', async ({
    page,
    volview,
    utils,
    oct,
    octInteraction,
    layerDisplay,
  }) => {
    const name = STEM + '/retina-padding.dcm';
    const padded = paddedSyntheticOCT(createSyntheticOCT());
    fs.writeFileSync(
      path.join(utils.makeTempDir(STEM), 'retina-padding.dcm'),
      padded.bytes
    );
    await utils.openVolViewPage(name);
    await oct.selectEnFace();
    await oct.setEnFaceWindow(1000, 500);
    await octInteraction.expectCalibratedEnFace();
    await octInteraction.expectProjectionPixel(255, 5, 12);
    await octInteraction.expectProjectionPixel(81, 60, 12);
    await page.locator(CANVAS).first().click();
    await volview.renderingModuleTab.click();
    await utils.waitForModuleTransitions();
    await layerDisplay.selectBasePalette('Inverted grayscale');
    await oct.waitForEnFaceReady();
    await octInteraction.expectProjectionPixel(0, 5, 12);
    await octInteraction.expectProjectionPixel(174, 60, 12);
    await layerDisplay.selectBasePalette('Grayscale');
    await oct.waitForEnFaceReady();
    await octInteraction.expectProjectionPixel(255, 5, 12);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('imports deflated OCT through the file dialog with calibrated geometry and padding', async ({
    volview,
    utils,
    oct,
    octInteraction,
  }) => {
    const directory = utils.makeTempDir(STEM);
    const file = path.join(directory, 'retina-padding-deflated.dcm');
    const padded = paddedSyntheticOCT(createSyntheticOCT());
    fs.writeFileSync(file, deflatedExplicitVR(padded.bytes));
    await volview.open();
    await utils.openThroughDialog(file);
    await volview.waitForViews();
    await oct.selectEnFace();
    await oct.setEnFaceWindow(1000, 500);
    await octInteraction.expectCalibratedEnFace();
    await octInteraction.expectProjectionPixel(255, 5, 12);
    await octInteraction.expectProjectionPixel(81, 60, 12);
  });

  test('projects a complete grayscale non-ophthalmic DICOM volume with standard contrast', async ({
    page,
    volview,
    utils,
    oct,
    octInteraction,
  }) => {
    const image = STEM + '/ordinary-volume.dcm';
    fs.writeFileSync(
      path.join(utils.makeTempDir(STEM), 'ordinary-volume.dcm'),
      nonOCTDicom(createSyntheticOCT())
    );
    await utils.openVolViewPage(image);
    await oct.selectEnFace();
    await oct.waitForEnFaceReady();
    await oct.setEnFaceWindow(1000, 500);
    await octInteraction.expectProjectionPixel(81);
    await oct.openEnFaceControls();
    await oct.selectSetting('enface-projection-method', 'Maximum');
    await volview.closeMenu(page.locator(CONTROLS).first());
    await oct.waitForEnFaceReady();
    await oct.setEnFaceWindow(1000, 500);
    await octInteraction.expectProjectionPixel(137);
    await expect(page.locator(WINDOW_TOOL)).toBeEnabled();
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('declines an OCT radial acquisition that requires spatial reconstruction', async ({
    utils,
    scratch,
    oct,
    octInteraction,
  }) => {
    const source = octInteraction.stageFixture('synthetic-oct.dcm');
    const raw = fs.readFileSync(scratch.path(source));
    const scanPatternOffset = raw.indexOf(Buffer.from('128280'));
    expect(scanPatternOffset).toBeGreaterThan(0);
    Buffer.from('128282').copy(raw, scanPatternOffset);
    const file = STEM + '/synthetic-oct-radial.dcm';
    fs.writeFileSync(scratch.path(file), raw);
    await utils.openVolViewPage(file);
    await oct.expectEnFaceDisabledInSwitcher('spatial reconstruction');
  });
});
