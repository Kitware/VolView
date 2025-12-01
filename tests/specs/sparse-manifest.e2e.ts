import { MINIMAL_DICOM } from './configTestUtils';
import {
  downloadFile,
  openVolViewPage,
  writeManifestToFile,
  writeManifestToZip,
} from './utils';

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

  it('loads standalone JSON state file (not zipped)', async () => {
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

    const fileName = 'standalone-state.volview.json';
    await writeManifestToFile(sparseManifest, fileName);
    await openVolViewPage(fileName);
  });
});
