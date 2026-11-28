import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../fixtures';
import { FIXTURES } from '../e2eRun';
import { containsText, setValueVueInput } from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import type { Utils } from './utils';
import { PROSTATEX_DATASET } from '../datasets';

const openLayeringFixtures = async (utils: Utils, scratch: Scratch) => {
  const fixtureNames = ['prostate-3-slices.zip', 'mra-head-neck-3-slices.zip'];
  await Promise.all(
    fixtureNames.map(async (name) => {
      const target = scratch.track(scratch.path(name));
      await fs.promises.copyFile(path.join(FIXTURES, 'layering', name), target);
    })
  );

  const manifestName = `layering-fixtures-${Date.now()}.json`;
  await utils.writeManifestToFile(
    {
      resources: fixtureNames.map((name) => ({ url: `/tmp/${name}` })),
    },
    manifestName
  );
  await utils.openVolViewPage(manifestName);
};

test.describe('Layers and Rendering', () => {
  test('should show 3D rendering controls regardless of active view', async ({
    page,
    volview,
    utils,
  }) => {
    await utils.openUrls([PROSTATEX_DATASET]);

    await volview.waitForViews();

    const renderTab = volview.renderingModuleTab;
    await renderTab.click();

    const view3D = await volview.getView3D();
    await volview.waitForLoadingIndicator(
      page.locator('[data-testid~="vtk-volume-view"]')
    );

    const volumeRenderingSection = volview.getVolumeRenderingSection();
    await expect(volumeRenderingSection).toBeAttached();
    await expect(volumeRenderingSection).toBeVisible();

    const pwfCanvas = page.locator('div.pwf-editor canvas');
    await expect(pwfCanvas).toBeAttached();

    await view3D!.click();
    await expect(volumeRenderingSection).toBeVisible();

    const view2D = await volview.getView2D();
    await view2D!.click();

    await expect(volumeRenderingSection).toBeVisible();
    await expect(pwfCanvas).toBeAttached();

    const volumePanel = page.locator('[data-testid="volume-rendering-panel"]');
    const toggle = page.locator('[data-testid="volume-rendering-toggle"]');
    const presets = volumePanel.locator('.v-expansion-panel-title', {
      hasText: containsText('Color Presets'),
    });
    const cinematic = volumePanel.locator('.v-expansion-panel-title', {
      hasText: containsText('Cinematic Rendering'),
    });
    const shift = volumePanel
      .locator('.mapping-range-editor .v-slider')
      .first()
      .locator('[role="slider"]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(presets).toBeVisible();
    await expect(cinematic).toBeVisible();
    const initialShift = await shift.getAttribute('aria-valuenow');
    await shift.focus();
    await page.keyboard.press('ArrowRight');
    await expect(shift).not.toHaveAttribute(
      'aria-valuenow',
      initialShift ?? ''
    );
    const editedShift = await shift.getAttribute('aria-valuenow');
    if (editedShift === null) throw new Error('Expected a displayed 3D shift');

    await toggle.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await utils.waitForModuleTransitions();
    await expect(pwfCanvas).toBeHidden();
    await expect(presets).toBeHidden();
    await expect(cinematic).toBeHidden();
    const minimum = page.locator('[data-testid="base-image-range-min"] input');
    const maximum = page.locator('[data-testid="base-image-range-max"] input');
    await expect(minimum).toBeVisible();
    await expect(minimum).toBeEnabled();
    await setValueVueInput(minimum, '0');
    await setValueVueInput(maximum, '100');
    await page.keyboard.press('Enter');
    for (const view of await volview.views2D.all())
      await expect(view).toContainText('W/L: 100.00 / 50.00');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await utils.waitForModuleTransitions();
    await expect(pwfCanvas).toBeVisible();
    await expect(presets).toBeVisible();
    await expect(cinematic).toBeVisible();
    await expect(shift).toHaveAttribute('aria-valuenow', editedShift);
    await expect(minimum).toHaveAttribute('title', '0');
    await expect(maximum).toHaveAttribute('title', '100');
  });

  test('should create overlay with 2 DICOM images', async ({
    page,
    volview,
    utils,
    scratch,
  }) => {
    await openLayeringFixtures(utils, scratch);

    await expect
      .poll(() => volview.datasetMenuButtons.count(), {
        message: 'Expected at least 2 dataset menu buttons to be available',
      })
      .toBeGreaterThanOrEqual(2);

    const mraCard = page.locator('.volume-card[html-title^="**TOF"]');
    await mraCard.click();

    const inactiveMenuSelector =
      '.volume-card:not(.volume-card-active) button[data-testid="dataset-menu-button"]';

    await expect
      .poll(
        async () =>
          (await page
            .locator(
              '.volume-card-active button[data-testid="dataset-menu-button"]'
            )
            .count()) >= 1 &&
          (await page.locator(inactiveMenuSelector).count()) >= 1,
        {
          message:
            'Expected active and inactive datasets to be available for layering',
        }
      )
      .toBe(true);

    await page.locator(inactiveMenuSelector).first().click();

    const addLayerButton = page.locator(
      'div[data-testid="dataset-menu-layer-item"]'
    );
    await expect(
      addLayerButton,
      'Expected clickable Add Layer button'
    ).toBeVisible();
    await addLayerButton.click();

    const renderTab = volview.renderingModuleTab;
    await renderTab.click();

    await expect
      .poll(() => volview.layerOpacitySliders.count(), {
        message: `Expected at least one layer opacity slider`,
      })
      .toBeGreaterThan(0);

    const minimum = page.locator('[data-testid="layer-range-min"] input');
    const maximum = page.locator('[data-testid="layer-range-max"] input');
    await expect(minimum).toBeEnabled();
    await utils.waitForModuleTransitions();
    // The resampled fixture spans scalar values 0 through 763.
    await setValueVueInput(minimum, '0');
    await setValueVueInput(maximum, '763');
    await expect(minimum).toHaveAttribute('title', '0');
    await expect(maximum).toHaveAttribute('title', '763');

    const firstSlider = volview.layerOpacitySliders.first();
    const sliderThumb = firstSlider.locator('[role="slider"]');
    const inputElement = firstSlider.locator('input');
    await sliderThumb.focus();
    await page.keyboard.press('Home');
    await expect(inputElement).toHaveValue('0');
    await utils.moveToElement(page.locator('header'));
    await expect
      .poll(
        async () => {
          const [axial] = await utils.capture2DViewScreenshotMetrics(
            'layers-zero-opacity.png'
          );
          return axial?.colored === 0 && axial.checksum > 1000;
        },
        {
          message: 'Expected grayscale MRA anatomy at zero overlay opacity',
        }
      )
      .toBe(true);

    await sliderThumb.focus();
    await page.keyboard.press('End');
    await expect(inputElement).toHaveValue('1');
    await utils.moveToElement(page.locator('header'));
    await expect
      .poll(
        async () => {
          const [axial] = await utils.capture2DViewScreenshotMetrics(
            'layers-full-opacity.png'
          );
          return axial?.colored > 1000;
        },
        {
          message:
            'Expected the resampled prostate overlay to add colored pixels to the MRA',
        }
      )
      .toBe(true);
  });
});
