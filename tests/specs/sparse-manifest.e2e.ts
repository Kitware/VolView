import * as path from 'path';
import * as fs from 'fs';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import JSZip from 'jszip';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { MINIMAL_DICOM } from './configTestUtils';
import { downloadFile } from './utils';

async function writeManifestToZip(manifest: unknown, fileName: string) {
  const filePath = path.join(TEMP_DIR, fileName);
  const manifestString = JSON.stringify(manifest, null, 2);

  const zip = new JSZip();
  zip.file('manifest.json', manifestString);
  const data = await zip.generateAsync({ type: 'nodebuffer' });

  await fs.promises.writeFile(filePath, data);
  cleanuptotal.addCleanup(async () => {
    fs.unlinkSync(filePath);
  });

  return filePath;
}

async function openVolViewPage(fileName: string) {
  const urlParams = `?urls=[tmp/${fileName}]`;
  await volViewPage.open(urlParams);
  await volViewPage.waitForViews();
}

describe('Sparse manifest.json', () => {
  it('loads manifest with only URL data source', async () => {
    await downloadFile(MINIMAL_DICOM.url, MINIMAL_DICOM.name);

    const sparseManifest = {
      version: '6.1.0',
      dataSources: [
        {
          id: 0,
          type: 'uri',
          uri: `/tmp/${MINIMAL_DICOM.name}`,
        },
      ],
    };

    const fileName = 'sparse-url-only.volview.zip';
    await writeManifestToZip(sparseManifest, fileName);
    await openVolViewPage(fileName);

    const notifications = await volViewPage.getNotificationsCount();
    expect(notifications).toEqual(0);
  });

  it('loads sparse manifest with tools section (rectangle)', async () => {
    await downloadFile(MINIMAL_DICOM.url, MINIMAL_DICOM.name);

    const sparseManifest = {
      version: '6.1.0',
      dataSources: [
        {
          id: 0,
          type: 'uri',
          uri: `/tmp/${MINIMAL_DICOM.name}`,
        },
      ],
      tools: {
        rectangles: {
          tools: [
            {
              imageID: '0',
              frameOfReference: {
                planeOrigin: [0, 0, 0],
                planeNormal: [0, 0, 1],
              },
              slice: 0,
              firstPoint: [10, 10, 0],
              secondPoint: [50, 50, 0],
              label: 'default',
            },
          ],
          labels: {
            default: {
              color: '#ff0000',
              strokeWidth: 2,
            },
          },
        },
      },
    };

    const fileName = 'sparse-url-rectangle.volview.zip';
    await writeManifestToZip(sparseManifest, fileName);
    await openVolViewPage(fileName);

    const notifications = await volViewPage.getNotificationsCount();
    expect(notifications).toEqual(0);

    const annotationsTab = await $(
      'button[data-testid="module-tab-Annotations"]'
    );
    await annotationsTab.click();

    const measurementsTab = await $('button.v-tab*=Measurements');
    await measurementsTab.waitForClickable();
    await measurementsTab.click();

    await browser.waitUntil(
      async () => {
        const rectangleEntries = await $$(
          '.v-list-item i.mdi-vector-square.tool-icon'
        );
        const count = await rectangleEntries.length;
        return count >= 1;
      },
      {
        timeout: 5000,
        timeoutMsg: 'Rectangle tool not found in measurements list',
      }
    );
  });
});
