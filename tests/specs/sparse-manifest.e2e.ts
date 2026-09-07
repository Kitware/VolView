import {
  MINIMAL_DICOM,
  PROSTATEX_DATASET,
  PROSTATE_SEGMENT_GROUP,
  PROSTATE_610_LABELMAP_MANIFEST,
} from './configTestUtils';
import {
  downloadFile,
  openVolViewPage,
  writeManifestToFile,
  writeManifestToZip,
} from './utils';
import { DOWNLOAD_TIMEOUT } from '../../wdio.shared.conf';
import {
  openAnnotationSegments,
  openMeasurements,
  waitForNamedSegments,
} from './segmentationTestUtils';

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

    await openMeasurements();

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

  it('loads remote segment group from URI', async () => {
    await downloadFile(PROSTATEX_DATASET.url, PROSTATEX_DATASET.name);
    await downloadFile(PROSTATE_SEGMENT_GROUP.url, PROSTATE_SEGMENT_GROUP.name);

    const fileName = 'remote-segment-group.volview.json';
    await writeManifestToFile(PROSTATE_610_LABELMAP_MANIFEST, fileName);
    await openVolViewPage(fileName);

    await openAnnotationSegments();
    await waitForNamedSegments(DOWNLOAD_TIMEOUT);

    // Verify the segment group source image is NOT in the Anonymous section
    const dataTab = await $('button[data-testid="module-tab-Data"]');
    await dataTab.click();

    // The Anonymous panel should not exist since the labelmap source image should be removed
    const anonymousPanelTitle = await $('.v-expansion-panel-title*=Anonymous');
    const exists = await anonymousPanelTitle.isExisting();
    expect(exists).toBe(false);
  });
});
