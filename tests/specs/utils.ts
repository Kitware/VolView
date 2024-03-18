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
    const response = await fetch(url);
    const data = await response.arrayBuffer();
    const buffer = Buffer.from(data);
    fs.writeFileSync(savePath, buffer);
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
  const fileName = 'openUrlsManifest.json';
  await writeManifestToFile(manifest, fileName);
  await openVolViewPage(fileName);
  await volViewPage.waitForViews();
}
