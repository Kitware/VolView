import * as path from 'path';
import * as fs from 'fs';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import JSZip from 'jszip';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import type { TestDataset } from '../datasets';

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
