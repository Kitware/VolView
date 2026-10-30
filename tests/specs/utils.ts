import * as path from 'path';
import * as fs from 'fs';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import type { TestDataset } from '../datasets';

export async function captureViewPixels(
  selector: string,
  inset: number,
  fileName: string
) {
  const screenshot = PNG.sync.read(
    await browser.saveScreenshot(path.join(TEMP_DIR, fileName))
  );
  const geometry = await browser.execute(
    (viewSelector) => ({
      width: window.innerWidth,
      height: window.innerHeight,
      views: Array.from(document.querySelectorAll(viewSelector)).map((view) => {
        const rect = view.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }),
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
}

export async function capture2DViewPixels(inset: number, fileName: string) {
  const views = await captureViewPixels(
    '[data-testid~="vtk-two-view"]',
    inset,
    fileName
  );
  return views.map(({ width, data }) => ({
    width,
    data: Array.from(data),
  }));
}

export async function capture2DViewScreenshotMetrics(fileName: string) {
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
        Math.max(red, green, blueChannel) - Math.min(red, green, blueChannel) >
        40
      )
        colored++;
      if (blueChannel > red + 40 && blueChannel > green + 40) blue++;
      checksum += red + 3 * green + 7 * blueChannel;
    }
    return { colored, blue, checksum };
  });
}

export async function waitForModuleTransitions() {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const container = document.getElementById('module-container')!;
        const transitioning = container.querySelector(
          '[class*="-enter-active"], [class*="-leave-active"]'
        );
        const animating = container
          .getAnimations({ subtree: true })
          .some(
            (animation) =>
              animation.playState === 'running' &&
              Number.isFinite(animation.effect?.getComputedTiming().endTime)
          );
        return !transitioning && !animating;
      }),
    {
      timeoutMsg: 'Expected the module panels to finish moving',
    }
  );
}

export async function selectLayout(
  name: string,
  count2D: number,
  has3D: boolean
) {
  await volViewPage.layoutButton.click();
  const option = $(`.v-list-item-title=${name}`);
  await option.waitForClickable();
  await option.click();
  await option.waitForDisplayed({ reverse: true });
  await volViewPage.waitForViewCounts(count2D, has3D);
}

export function writeMetaImage(
  fileName: string,
  { spacing = '1 1 1', size = 16, step = 1 } = {}
) {
  const filePath = path.join(TEMP_DIR, fileName);
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
  fs.writeFileSync(filePath, Buffer.concat([Buffer.from(header), voxels]));

  cleanuptotal.addCleanup(async () => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  return fileName;
}

/**
 * A directory under TEMP_DIR for one spec's generated files, removed with
 * everything in it once the run finishes.
 */
export function makeTempDir(dirName: string) {
  const dir = path.join(TEMP_DIR, dirName);
  fs.mkdirSync(dir, { recursive: true });
  cleanuptotal.addCleanup(async () => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

export async function writeManifestToFile(manifest: unknown, fileName: string) {
  const filePath = path.join(TEMP_DIR, fileName);
  await fs.promises.writeFile(filePath, JSON.stringify(manifest));
  cleanuptotal.addCleanup(async () => {
    fs.unlinkSync(filePath);
  });
  return filePath;
}

export async function writeManifestToZip(
  manifest: unknown | string,
  fileName: string
) {
  const filePath = path.join(TEMP_DIR, fileName);
  const manifestString =
    typeof manifest === 'string'
      ? fs.readFileSync(manifest)
      : JSON.stringify(manifest, null, 2);

  const zip = new JSZip();
  zip.file('manifest.json', manifestString);
  const data = await zip.generateAsync({ type: 'nodebuffer' });

  await fs.promises.writeFile(filePath, data);
  cleanuptotal.addCleanup(async () => {
    fs.unlinkSync(filePath);
  });

  return filePath;
}

export async function openVolViewPage(fileName: string) {
  const urlParams = `?urls=[tmp/${fileName}]`;
  await volViewPage.open(urlParams);
  await volViewPage.waitForViews();
  const notifications = await volViewPage.getNotificationsCount();
  expect(notifications).toEqual(0);
}

export const SESSION_SAVE_TIMEOUT = 40_000;

const waitForFile = (
  filePath: string,
  timeout: number,
  ready: (stats: fs.Stats) => boolean
) =>
  new Promise<void>((resolve, reject) => {
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath);
    const check = () => {
      try {
        if (!ready(fs.statSync(filePath))) return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        clearTimeout(timerId);
        watcher.close();
        reject(error);
        return;
      }
      clearTimeout(timerId);
      watcher.close();
      resolve();
    };
    const watcher = fs.watch(dir, (_, filename) => {
      if (filename === null || filename === basename) check();
    });
    const timerId = setTimeout(() => {
      watcher.close();
      reject(new Error(`File ${filePath} was not ready within ${timeout}ms`));
    }, timeout);
    watcher.on('error', (error) => {
      clearTimeout(timerId);
      watcher.close();
      reject(error);
    });
    check();
  });

export const waitForFileExists = (filePath: string, timeout: number) =>
  waitForFile(filePath, timeout, () => true);

// Download creation and its first bytes share the caller's existing wait budget.
export const waitForDownload = (filePath: string, timeout: number) =>
  waitForFile(filePath, timeout, (stats) => stats.size > 0);

export async function openUrls(datasets: ReadonlyArray<TestDataset>) {
  const manifest = {
    resources: datasets.map(({ name }) => ({ url: `/tmp/${name}` })),
  };
  const fileName = `openUrlsManifest_${Date.now()}_${Math.random()
    .toString(36)
    .substring(7)}.json`;
  await writeManifestToFile(manifest, fileName);
  await openVolViewPage(fileName);
}

/** Drops local files onto the open app using its files-list import path. */
export async function dropFiles(filePaths: string[]) {
  const encoded = filePaths.map((filePath) => ({
    name: path.basename(filePath),
    base64: fs.readFileSync(filePath).toString('base64'),
  }));
  const dropped = await browser.execute(
    (files: Array<{ name: string; base64: string }>) => {
      const transfer = new DataTransfer();
      files.forEach(({ name, base64 }) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1)
          bytes[i] = binary.charCodeAt(i);
        transfer.items.add(new File([bytes], name));
      });

      const target = document.querySelector('#app-container');
      if (!target) return false;

      const drop = new Event('drop', { bubbles: true, cancelable: true });
      // Synthetic items have no filesystem entry, so use the files list.
      Object.defineProperty(drop, 'dataTransfer', {
        value: { items: null, files: transfer.files },
      });
      // dispatchEvent reports preventDefault, not delivery.
      target.dispatchEvent(drop);
      return true;
    },
    encoded
  );
  expect(dropped).toBe(true);
}

/** Loads a file into the page already open, through the Open files dialog. */
export async function openThroughDialog(
  filePath: string,
  beforeSelection?: () => Promise<unknown>
) {
  await browser.sessionSubscribe({ events: ['input.fileDialogOpened'] });
  const opened = new Promise<{
    context: string;
    element?: { sharedId: string };
  }>((resolve) => browser.once('input.fileDialogOpened', resolve));
  await $('[data-testid="control-button-Open files"]').click();
  const { context, element } = await opened;
  if (!element) throw new Error('The file dialog opened for no input');
  await beforeSelection?.();
  await browser.inputSetFiles({ context, element, files: [filePath] });
}
