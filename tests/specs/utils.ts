import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { expect, type Locator, type Page } from '@playwright/test';
import { TEMP_DIR } from '../e2eRun';
import {
  containsText,
  createVolViewPage,
  exactText,
  waitForTransitions,
} from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import type { TestDataset } from '../datasets';

export const createUtils = (page: Page, scratch: Scratch) => {
  const volview = createVolViewPage(page, scratch);

  const captureViewPixels = async (
    selector: string,
    inset: number,
    fileName: string
  ) => {
    const screenshot = PNG.sync.read(
      await page.screenshot({ path: path.join(TEMP_DIR, fileName) })
    );
    const geometry = await page.evaluate(
      (viewSelector) => ({
        width: window.innerWidth,
        height: window.innerHeight,
        views: Array.from(document.querySelectorAll(viewSelector)).map(
          (view) => {
            const rect = view.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            };
          }
        ),
      }),
      selector
    );
    const scaleX = screenshot.width / geometry.width;
    const scaleY = screenshot.height / geometry.height;
    return geometry.views.map((rect) => {
      const x = Math.trunc((rect.x + inset) * scaleX);
      const y = Math.trunc((rect.y + inset) * scaleY);
      const width = Math.trunc((rect.width - 2 * inset) * scaleX);
      const height = Math.trunc((rect.height - 2 * inset) * scaleY);
      if (
        width <= 0 ||
        height <= 0 ||
        x < 0 ||
        y < 0 ||
        x + width > screenshot.width ||
        y + height > screenshot.height
      )
        throw new Error(
          `Expected a nonempty view crop inside the screenshot: ${selector}`
        );
      const data = Buffer.alloc(width * height * 4);
      for (let row = 0; row < height; row++) {
        const source = ((y + row) * screenshot.width + x) * 4;
        screenshot.data.copy(data, row * width * 4, source, source + width * 4);
      }
      return { width, data };
    });
  };

  const capture2DViewPixels = async (inset: number, fileName: string) => {
    const views = await captureViewPixels(
      '[data-testid~="vtk-two-view"]',
      inset,
      fileName
    );
    return views.map(({ width, data }) => ({
      width,
      data: Array.from(data),
    }));
  };

  const capture2DViewScreenshotMetrics = async (fileName: string) => {
    const views = await captureViewPixels(
      '[data-testid~="vtk-two-view"]',
      40,
      fileName
    );
    return views.map(({ data }) => {
      let colored = 0;
      let blue = 0;
      let checksum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const red = data[i];
        const green = data[i + 1];
        const blueChannel = data[i + 2];
        if (
          Math.max(red, green, blueChannel) -
            Math.min(red, green, blueChannel) >
          40
        )
          colored++;
        if (blueChannel > red + 40 && blueChannel > green + 40) blue++;
        checksum += red + 3 * green + 7 * blueChannel;
      }
      return { colored, blue, checksum };
    });
  };

  const waitForModuleTransitions = () =>
    waitForTransitions(
      page.locator('#module-container'),
      'Expected the module panels to finish moving'
    );

  /** Moves the pointer onto the center of `locator` without clicking. */
  const moveToElement = async (locator: Locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error('Expected the element to be on screen');
    await page.mouse.move(
      Math.round(box.x + box.width / 2),
      Math.round(box.y + box.height / 2)
    );
  };

  const selectLayout = async (
    name: string,
    count2D: number,
    has3D: boolean
  ) => {
    await volview.layoutButton.click();
    const option = page.locator('.v-list-item-title', {
      hasText: exactText(name),
    });
    await option.click();
    await expect(option).toBeHidden();
    await volview.waitForViewCounts(count2D, has3D);
  };

  const waitForOpenMenu = () =>
    waitForTransitions(
      page.locator('.v-menu.v-overlay--active .v-overlay__content').first()
    );

  const showObliqueLayout = async () => {
    await volview.layoutButton.click();
    await waitForOpenMenu();
    await page
      .locator('.v-list-item-title', { hasText: exactText('Oblique') })
      .click();
    await expect(page.locator('.oblique-grid')).toBeVisible();
  };

  /** Shows the image of `card` in every view through its dataset menu. */
  const showInAllViews = async (card: Locator) => {
    await card.locator('[data-testid="dataset-menu-button"]').click();
    await waitForOpenMenu();
    await page
      .locator('.v-list-item', { hasText: containsText('Show in all views') })
      .first()
      .click();
    await page.keyboard.press('Escape');
  };

  /** Picks the layout grid cell at `index`, which shows `count` views. */
  const selectGrid = async (index: number, count: number) => {
    await volview.layoutButton.click();
    const cell = page.locator(
      `.v-menu .grid-cell:nth-child(${index + 1}) .grid-cell-box`
    );
    await cell.hover();
    await cell.click();
    await expect(cell).toBeHidden();
    await expect(page.locator('.grid-item')).toHaveCount(count);
  };

  const writeMetaImage = (
    fileName: string,
    { spacing = '1 1 1', size = 16, step = 1 } = {}
  ) => {
    const header = [
      'ObjectType = Image',
      'NDims = 3',
      `DimSize = ${size} ${size} ${size}`,
      `ElementSpacing = ${spacing}`,
      'ElementType = MET_UCHAR',
      'ElementDataFile = LOCAL',
      '',
    ].join('\n');
    const voxels = Uint8Array.from(
      { length: size ** 3 },
      (_, i) => (i * step) % 256
    );
    scratch.writeFile(fileName, Buffer.concat([Buffer.from(header), voxels]));
    return fileName;
  };

  /** A directory under TEMP_DIR for one spec's generated files. */
  const makeTempDir = (dirName: string) => scratch.makeDir(dirName);

  const writeManifestToFile = async (manifest: unknown, fileName: string) =>
    scratch.writeFile(fileName, JSON.stringify(manifest));

  const writeManifestToZip = async (
    manifest: unknown | string,
    fileName: string
  ) => {
    const manifestString =
      typeof manifest === 'string'
        ? fs.readFileSync(manifest)
        : JSON.stringify(manifest, null, 2);
    const zip = new JSZip();
    zip.file('manifest.json', manifestString);
    return scratch.writeFile(
      fileName,
      await zip.generateAsync({ type: 'nodebuffer' })
    );
  };

  /** Opens a generated file under TEMP_DIR through a one-entry manifest. */
  const openFileThroughManifest = async (
    fileName: string,
    manifestName: string
  ) => {
    await writeManifestToFile(
      { resources: [{ url: `/tmp/${fileName}`, name: fileName }] },
      manifestName
    );
    await volview.open(`?urls=[tmp/${manifestName}]`);
  };

  const openVolViewPage = async (fileName: string) => {
    await volview.open(`?urls=[tmp/${fileName}]`);
    await volview.waitForViews();
    expect(await volview.getNotificationsCount()).toEqual(0);
  };

  const readSavedSessionWithoutSelection = async (sessionFileName: string) => {
    const zip = await JSZip.loadAsync(
      fs.readFileSync(path.join(TEMP_DIR, sessionFileName))
    );
    const manifest = JSON.parse(
      await zip.file('manifest.json')!.async('string')
    );
    manifest.imageSegments.forEach((entry: { selectedSegmentId?: string }) => {
      delete entry.selectedSegmentId;
    });
    zip.file('manifest.json', JSON.stringify(manifest));
    return { zip, manifest };
  };

  const openUrls = async (datasets: ReadonlyArray<TestDataset>) => {
    const manifest = {
      resources: datasets.map(({ name }) => ({ url: `/tmp/${name}` })),
    };
    const fileName = `openUrlsManifest_${Date.now()}_${Math.random()
      .toString(36)
      .substring(7)}.json`;
    await writeManifestToFile(manifest, fileName);
    await openVolViewPage(fileName);
  };

  const openTwoImagesInFourUp = async (
    datasets: readonly [TestDataset, TestDataset]
  ) => {
    await openUrls(datasets);
    await volview.waitForViews();
    await expect
      .poll(() => page.locator('.volume-card').count(), {
        message: 'Expected both volume cards to appear',
      })
      .toBeGreaterThanOrEqual(2);
    await expect(
      page.locator('.grid-item'),
      'Expected the Four Up layout (4 slots)'
    ).toHaveCount(4);
  };

  /** The item labelled `label` in the open Vuetify menu or select list. */
  const overlayOption = (label: string) =>
    page.locator('div.v-overlay--active div.v-list-item', {
      hasText: exactText(label),
    });

  /** Route a sample's compiled URL to the locally cached fixture. */
  const useCachedSample = (dataset: { origin: string; name: string }) =>
    page.addInitScript(
      ({ remote, local }) => {
        const original = window.fetch;
        window.fetch = (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url !== remote) return original(input, init);
          const target =
            input instanceof Request
              ? new Request(new URL(local, location.href), input)
              : local;
          return original(target, init);
        };
      },
      { remote: dataset.origin, local: `/tmp/${dataset.name}` }
    );

  /** Loads a file into the page already open, through the Open files dialog. */
  const openThroughDialog = async (
    filePath: string,
    beforeSelection?: () => Promise<unknown>
  ) => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid="control-button-Open files"]').click(),
    ]);
    await beforeSelection?.();
    await chooser.setFiles(filePath);
  };

  return {
    captureViewPixels,
    capture2DViewPixels,
    capture2DViewScreenshotMetrics,
    waitForModuleTransitions,
    moveToElement,
    selectLayout,
    showObliqueLayout,
    showInAllViews,
    selectGrid,
    writeMetaImage,
    makeTempDir,
    writeManifestToFile,
    openFileThroughManifest,
    writeManifestToZip,
    openVolViewPage,
    readSavedSessionWithoutSelection,
    openUrls,
    openTwoImagesInFourUp,
    overlayOption,
    useCachedSample,
    openThroughDialog,
  };
};

export type Utils = ReturnType<typeof createUtils>;
