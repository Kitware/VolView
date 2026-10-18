import * as path from 'path';
import * as fs from 'fs';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import JSZip from 'jszip';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import type { TestDataset } from '../datasets';

async function capture2DViews(
  inset: number,
  fileName: string,
  metricsOnly = false
) {
  const capture = (
    await browser.saveScreenshot(path.join(TEMP_DIR, fileName))
  ).toString('base64');
  return browser.execute(
    async (png, margin, summarize) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const scaleX = image.width / window.innerWidth;
      const scaleY = summarize ? image.height / window.innerHeight : scaleX;
      const selector = summarize
        ? 'div[data-testid~="vtk-two-view"]'
        : '[data-testid~="vtk-two-view"]';
      return Array.from(document.querySelectorAll(selector)).map((view) => {
        const rect = view.getBoundingClientRect();
        const pixels = context.getImageData(
          (rect.x + margin) * scaleX,
          (rect.y + margin) * scaleY,
          (rect.width - 2 * margin) * scaleX,
          (rect.height - 2 * margin) * scaleY
        );
        let colored = 0;
        let blue = 0;
        let checksum = 0;
        if (summarize) {
          const { data } = pixels;
          for (let i = 0; i < data.length; i += 4) {
            const channels = [data[i], data[i + 1], data[i + 2]];
            if (Math.max(...channels) - Math.min(...channels) > 40) colored++;
            if (data[i + 2] > data[i] + 40 && data[i + 2] > data[i + 1] + 40)
              blue++;
            checksum += data[i] + 3 * data[i + 1] + 7 * data[i + 2];
          }
        }
        return {
          width: pixels.width,
          data: summarize ? [] : Array.from(pixels.data),
          colored,
          blue,
          checksum,
        };
      });
    },
    capture,
    inset,
    metricsOnly
  );
}

export async function capture2DViewPixels(inset: number, fileName: string) {
  return (await capture2DViews(inset, fileName)).map(({ width, data }) => ({
    width,
    data,
  }));
}

export async function capture2DViewScreenshotMetrics(fileName: string) {
  return (await capture2DViews(40, fileName, true)).map(
    ({ colored, blue, checksum }) => ({ colored, blue, checksum })
  );
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

/** Loads a file into the page already open, through the Open files dialog. */
export async function openThroughDialog(filePath: string) {
  await browser.sessionSubscribe({ events: ['input.fileDialogOpened'] });
  const opened = new Promise<{
    context: string;
    element?: { sharedId: string };
  }>((resolve) => browser.once('input.fileDialogOpened', resolve));
  await $('[data-testid="control-button-Open files"]').click();
  const { context, element } = await opened;
  if (!element) throw new Error('The file dialog opened for no input');
  await browser.inputSetFiles({ context, element, files: [filePath] });
}
