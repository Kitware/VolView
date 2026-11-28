import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { z } from 'zod';
import type { Page } from '@playwright/test';
import type { ManifestSchema } from '@/src/io/state-file/schema';
import { test, expect } from '../fixtures';
import { ONE_CT_SLICE_DICOM } from '../datasets';
import {
  containsText,
  setValueVueInput,
  type VolViewPage,
} from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import type { Utils } from './utils';

type Fixtures = {
  page: Page;
  volview: VolViewPage;
  utils: Utils;
  scratch: Scratch;
};

const field = (page: Page, endpoint: 'min' | 'max') =>
  page.locator(`[data-testid="base-image-range-${endpoint}"] input`);
const visibility = (page: Page) =>
  page.locator('[data-testid="base-image-visibility"]');
const palette = (page: Page) =>
  page.locator('[data-testid="base-image-colormap"]');
const capture = (utils: Utils) =>
  utils.capture2DViewScreenshotMetrics('legacy-window-appearance.png');

const expectRange = async (
  { page, volview }: Fixtures,
  min: number,
  max: number
) => {
  await expect(field(page, 'min')).toHaveAttribute('title', String(min));
  await expect(field(page, 'max')).toHaveAttribute('title', String(max));
  await expect(volview.views2D.first()).toContainText(
    `W/L: ${(max - min).toFixed(2)} / ${((max + min) / 2).toFixed(2)}`,
    { useInnerText: true }
  );
};

const setRange = async (fixtures: Fixtures, min: number, max: number) => {
  const { page } = fixtures;
  await setValueVueInput(field(page, 'min'), String(min));
  await setValueVueInput(field(page, 'max'), String(max));
  await page.keyboard.press('Enter');
  await expectRange(fixtures, min, max);
};

const saveSession = async ({ volview, scratch }: Fixtures) =>
  scratch.path(await volview.saveSession());

const omitSavedAppearance = async (scratch: Scratch, filePath: string) => {
  const zip = await JSZip.loadAsync(readFileSync(filePath));
  const manifest = JSON.parse(
    await zip.file('manifest.json')!.async('string')
  ) as z.input<typeof ManifestSchema>;
  const windows = Object.values(manifest.viewByID ?? {}).flatMap((view) =>
    Object.values(view.config ?? {}).flatMap(({ window }) => window ?? [])
  );
  expect(windows.length).toBeGreaterThan(0);
  windows.forEach((window) => {
    delete window.visibility;
    delete window.preset;
  });
  zip.file('manifest.json', JSON.stringify(manifest));
  return scratch.writeFile(
    'legacy-window.volview.zip',
    await zip.generateAsync({ type: 'nodebuffer' })
  );
};

const clearTransientUI = async ({ page, utils }: Fixtures) => {
  await utils.moveToElement(page.locator('header'));
  await expect(page.locator('.Vue-Toastification__toast')).toHaveCount(0);
};

const restoreLegacySession = async (fixtures: Fixtures, filePath: string) => {
  const { page, utils } = fixtures;
  await utils.openThroughDialog(filePath);
  await expectRange(fixtures, -100, 200);
  await expect(palette(page)).toContainText('Grayscale');
  await expect(visibility(page)).toContainText('HIDE', { useInnerText: true });
  await clearTransientUI(fixtures);
};

test.describe('Legacy saved base appearance', () => {
  test('restores grayscale and visibility when reopening the same DICOM session', async ({
    page,
    volview,
    utils,
    scratch,
  }) => {
    const fixtures = { page, volview, utils, scratch };
    await utils.openUrls([ONE_CT_SLICE_DICOM]);
    await utils.selectLayout('Axial Only', 1, false);
    await volview.renderingModuleTab.click();
    await utils.waitForModuleTransitions();
    await field(page, 'min').evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await setRange(fixtures, -100, 200);
    const legacyPath = await omitSavedAppearance(
      scratch,
      await saveSession(fixtures)
    );
    await setRange(fixtures, -120, 180);
    await restoreLegacySession(fixtures, legacyPath);
    await expect
      .poll(async () => {
        const [pixels] = await capture(utils);
        return pixels.colored === 0 && pixels.checksum > 1_000_000;
      })
      .toBe(true);
    const [original] = await capture(utils);

    await palette(page).evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await palette(page).click();
    const option = page.locator('[role="option"]', {
      hasText: containsText('Viridis'),
    });
    await option.evaluate((element) =>
      element.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    );
    await option.click();
    await setRange(fixtures, -50, 150);
    await clearTransientUI(fixtures);
    await expect
      .poll(async () => (await capture(utils))[0].colored)
      .toBeGreaterThan(1000);
    await visibility(page).click();
    await expect(visibility(page)).toContainText('SHOW', {
      useInnerText: true,
    });
    await expect
      .poll(async () => (await capture(utils))[0].checksum)
      .toBeLessThan(original.checksum / 4);
    const editedPath = await saveSession(fixtures);

    await restoreLegacySession(fixtures, legacyPath);
    await expect
      .poll(async () => (await capture(utils))[0].checksum, {
        message: 'Expected the original visible grayscale DICOM slice',
      })
      .toBe(original.checksum);

    await utils.openThroughDialog(editedPath);
    await expectRange(fixtures, -50, 150);
    await expect(palette(page)).toContainText('Viridis');
    await expect(visibility(page)).toContainText('SHOW', {
      useInnerText: true,
    });
    await clearTransientUI(fixtures);
    await expect
      .poll(async () => (await capture(utils))[0].checksum)
      .toBeLessThan(original.checksum / 4);
    await visibility(page).click();
    await expect
      .poll(async () => (await capture(utils))[0].colored)
      .toBeGreaterThan(1000);
  });
});
