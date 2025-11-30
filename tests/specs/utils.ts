import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import JSZip from 'jszip';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { RemoteResource } from '../../src/io/manifest';

// File is not automatically deleted
export const downloadFile = async (url: string, fileName: string) => {
  const savePath = path.join(TEMP_DIR, fileName);
  if (!fs.existsSync(savePath)) {
    // Download to a temporary file first to avoid race conditions
    const tempPath = `${savePath}.${process.pid}.${Date.now()}.tmp`;
    const response = await fetch(url);
    const data = await response.arrayBuffer();
    const buffer = Buffer.from(data);
    fs.writeFileSync(tempPath, buffer);

    // Atomic rename - if another process already created the file, this will fail safely
    try {
      fs.renameSync(tempPath, savePath);
    } catch (err) {
      // Another process beat us to it, clean up our temp file
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }
      // Check if the final file exists and is complete
      if (!fs.existsSync(savePath)) {
        throw new Error(`Failed to download ${fileName}: ${err}`);
      }
    }
  }
  return savePath;
};

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

type RemoteResourceType = z.infer<typeof RemoteResource> & { name: string };

export async function openUrls(urlsAndNames: Array<RemoteResourceType>) {
  await Promise.all(
    urlsAndNames.map((resource) => downloadFile(resource.url, resource.name))
  );

  const resources = urlsAndNames.map(({ name }) => ({ url: `/tmp/${name}` }));
  const manifest = {
    resources,
  };
  const fileName = `openUrlsManifest_${Date.now()}_${Math.random()
    .toString(36)
    .substring(7)}.json`;
  await writeManifestToFile(manifest, fileName);
  await openVolViewPage(fileName);
}
