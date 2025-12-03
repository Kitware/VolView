import { PROSTATEX_DATASET } from './configTestUtils';
import { downloadFile, openVolViewPage, writeManifestToZip } from './utils';

describe('Sparse manifest with prostate rectangle', () => {
  it('loads prostate dataset with lesion rectangle annotation', async () => {
    await downloadFile(PROSTATEX_DATASET.url, PROSTATEX_DATASET.name);

    const sparseManifest = {
      version: '6.1.0',
      dataSources: [
        {
          id: 0,
          type: 'uri',
          uri: `/tmp/${PROSTATEX_DATASET.name}`,
        },
      ],
      tools: {
        rectangles: {
          tools: [
            {
              imageID: '0',
              frameOfReference: {
                planeNormal: [
                  1.4080733262381892e-17, 0.24192188680171967,
                  0.9702957272529602,
                ],
                planeOrigin: [
                  -117.91325380387, -75.35208187384475, 52.136969503946816,
                ],
              },
              slice: 9,
              firstPoint: [
                -65.36087045590452, -15.919061788109012, 37.31865385684797,
              ],
              secondPoint: [
                22.78165684736155, 47.65944636974224, 21.46675198654735,
              ],
              label: 'lesion',
            },
          ],
          labels: {
            lesion: {
              labelName: 'lesion',
              color: 'red',
              strokeWidth: 1,
              fillColor: 'transparent',
            },
          },
        },
      },
    };

    const fileName = 'sparse-prostate-lesion-rectangle.volview.zip';
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
        timeout: 10000,
        timeoutMsg: 'Rectangle tool not found in measurements list',
      }
    );

    await browser.waitUntil(
      async () => {
        const listItemTitles = await $$('.v-list-item .v-list-item-title');
        for (const title of listItemTitles) {
          const text = await title.getText();
          if (text.includes('lesion')) return true;
        }
        return false;
      },
      {
        timeout: 5000,
        timeoutMsg: 'Lesion label not found on rectangle annotation',
      }
    );
  });
});
