import { test, expect } from '../fixtures';
import { PROSTATE_610_LABELMAP_MANIFEST } from './configTestUtils';
import { MINIMAL_DICOM } from '../datasets';
import { containsText } from '../pageobjects/volview.page';

test.describe('Sparse manifest.json', () => {
  test('loads manifest with only URL data source', async ({ utils }) => {
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
    await utils.writeManifestToZip(sparseManifest, fileName);
    await utils.openVolViewPage(fileName);
  });

  test('loads sparse manifest with tools section (rectangle)', async ({
    page,
    utils,
    segmentation,
  }) => {
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
    await utils.writeManifestToZip(sparseManifest, fileName);
    await utils.openVolViewPage(fileName);

    await segmentation.openSegmentShapes();

    await expect
      .poll(
        () =>
          page
            .locator('[data-testid="segment-shape-row"] i.mdi-vector-square')
            .count(),
        { message: 'Rectangle tool not found in measurements list' }
      )
      .toBeGreaterThanOrEqual(1);
  });

  test('loads standalone JSON state file (not zipped)', async ({ utils }) => {
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
    await utils.writeManifestToFile(sparseManifest, fileName);
    await utils.openVolViewPage(fileName);
  });

  test('loads remote segment group from URI', async ({
    page,
    utils,
    segmentation,
  }) => {
    const fileName = 'remote-segment-group.volview.json';
    await utils.writeManifestToFile(PROSTATE_610_LABELMAP_MANIFEST, fileName);
    await utils.openVolViewPage(fileName);

    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
    await segmentation.waitForSegmentContent('Right hip');

    // Verify the segment group source image is NOT in the Anonymous section
    const dataTab = page.locator('button[data-testid="module-tab-Data"]');
    await dataTab.click();

    // The Anonymous panel should not exist since the labelmap source image should be removed
    const anonymousPanelTitle = page.locator('.v-expansion-panel-title', {
      hasText: containsText('Anonymous'),
    });
    const exists = (await anonymousPanelTitle.count()) > 0;
    expect(exists).toBe(false);
  });
});
