import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { z } from 'zod';
import type { ManifestSchema } from '@/src/io/state-file/schema';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { ONE_CT_SLICE_DICOM } from '../datasets';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  capture2DViewScreenshotMetrics,
  openThroughDialog,
  openUrls,
  selectLayout,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  waitForModuleTransitions,
} from './utils';

const field = (endpoint: 'min' | 'max') =>
  $(`[data-testid="base-image-range-${endpoint}"] input`);
const visibility = () => $('[data-testid="base-image-visibility"]');
const palette = () => $('[data-testid="base-image-colormap"]');
const capture = () =>
  capture2DViewScreenshotMetrics('legacy-window-appearance.png');

const expectRange = async (min: number, max: number) => {
  await expect(field('min')).toHaveAttribute('title', String(min));
  await expect(field('max')).toHaveAttribute('title', String(max));
  await expect((await volViewPage.getViews2D())[0]).toHaveText(
    expect.stringContaining(
      `W/L: ${(max - min).toFixed(2)} / ${((max + min) / 2).toFixed(2)}`
    )
  );
};

const setRange = async (min: number, max: number) => {
  await setValueVueInput(field('min'), String(min));
  await setValueVueInput(field('max'), String(max));
  await browser.keys('Enter');
  await expectRange(min, max);
};

const saveSession = async () => {
  const filename = await volViewPage.saveSession();
  const filePath = join(TEMP_DIR, filename);
  await waitForDownload(filePath, SESSION_SAVE_TIMEOUT);
  return filePath;
};

const omitSavedAppearance = async (filePath: string) => {
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
  const legacyPath = join(TEMP_DIR, 'legacy-window.volview.zip');
  writeFileSync(legacyPath, await zip.generateAsync({ type: 'nodebuffer' }));
  return legacyPath;
};

const clearTransientUI = async () => {
  await $('header').moveTo();
  await browser.waitUntil(
    async () => (await $$('.Vue-Toastification__toast').length) === 0
  );
};

const restoreLegacySession = async (filePath: string) => {
  await openThroughDialog(filePath);
  await expectRange(-100, 200);
  await expect(palette()).toHaveText(expect.stringContaining('Grayscale'));
  await expect(visibility()).toHaveText(expect.stringContaining('HIDE'));
  await clearTransientUI();
};

describe('Legacy saved base appearance', () => {
  it('restores grayscale and visibility when reopening the same DICOM session', async () => {
    await openUrls([ONE_CT_SLICE_DICOM]);
    await selectLayout('Axial Only', 1, false);
    await volViewPage.renderingModuleTab.click();
    await waitForModuleTransitions();
    await field('min').scrollIntoView({ block: 'center', behavior: 'instant' });
    await setRange(-100, 200);
    const legacyPath = await omitSavedAppearance(await saveSession());
    await setRange(-120, 180);
    await restoreLegacySession(legacyPath);
    await browser.waitUntil(async () => {
      const [pixels] = await capture();
      return pixels.colored === 0 && pixels.checksum > 1_000_000;
    });
    const [original] = await capture();

    await palette().scrollIntoView({ block: 'center', behavior: 'instant' });
    await palette().click();
    const option = $('[role="option"]*=Viridis');
    await option.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    await option.waitForStable();
    await option.click();
    await setRange(-50, 150);
    await clearTransientUI();
    await browser.waitUntil(async () => (await capture())[0].colored > 1000);
    await visibility().click();
    await expect(visibility()).toHaveText(expect.stringContaining('SHOW'));
    await browser.waitUntil(
      async () => (await capture())[0].checksum < original.checksum / 4
    );
    const editedPath = await saveSession();

    await restoreLegacySession(legacyPath);
    await browser.waitUntil(
      async () => (await capture())[0].checksum === original.checksum,
      { timeoutMsg: 'Expected the original visible grayscale DICOM slice' }
    );

    await openThroughDialog(editedPath);
    await expectRange(-50, 150);
    await expect(palette()).toHaveText(expect.stringContaining('Viridis'));
    await expect(visibility()).toHaveText(expect.stringContaining('SHOW'));
    await clearTransientUI();
    await browser.waitUntil(
      async () => (await capture())[0].checksum < original.checksum / 4
    );
    await visibility().click();
    await browser.waitUntil(async () => (await capture())[0].colored > 1000);
  });
});
