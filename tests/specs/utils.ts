import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
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

export async function writeManifestToFile(manifest: any, fileName: string) {
  const filePath = path.join(TEMP_DIR, fileName);
  await fs.promises.writeFile(filePath, JSON.stringify(manifest));
  cleanuptotal.addCleanup(async () => {
    fs.unlinkSync(filePath);
  });
  return filePath;
}

export async function openVolViewPage(fileName: string) {
  const urlParams = `?urls=[tmp/${fileName}]`;
  await volViewPage.open(urlParams);
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
  // Use a unique filename to avoid race conditions when tests run in parallel
  const fileName = `openUrlsManifest_${Date.now()}_${Math.random()
    .toString(36)
    .substring(7)}.json`;
  await writeManifestToFile(manifest, fileName);
  await openVolViewPage(fileName);
  await volViewPage.waitForViews();
}
