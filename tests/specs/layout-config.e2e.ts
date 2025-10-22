import * as path from 'path';
import * as fs from 'fs';
import { volViewPage } from '../pageobjects/volview.page';
import { FIXTURES, DOWNLOAD_TIMEOUT } from '../../wdio.shared.conf';
import { writeManifestToFile } from './utils';

describe('VolView Layout Configuration', () => {
  it('should load single view layout from config', async () => {
    const configPath = path.join(FIXTURES, 'config-layout-1x1.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const configFileName = 'config-layout-1x1.json';
    await writeManifestToFile(config, configFileName);

    await volViewPage.open(`?urls=[tmp/${configFileName}]`);

    await browser.pause(2000);

    await volViewPage.downloadProstateSample();

    await volViewPage.waitForViews();

    await browser.waitUntil(
      async () => {
        const currentViews = await volViewPage.views;
        const viewCount = await currentViews.length;

        if (viewCount !== 1) {
          return false;
        }

        const view = currentViews[0];
        const width = await view.getAttribute('width');
        const height = await view.getAttribute('height');

        if (!width || !height) {
          return false;
        }

        const w = parseInt(width, 10);
        const h = parseInt(height, 10);

        return w > 200 && h > 200;
      },
      {
        timeout: DOWNLOAD_TIMEOUT,
        timeoutMsg: 'Expected exactly 1 view with rendered content',
        interval: 1000,
      }
    );

    const views = await volViewPage.views;
    await expect(views).toHaveLength(1);
  });

  it('should create a 2x2 grid layout from simple string array', async () => {
    const config = {
      layout: [
        ['axial', 'sagittal'],
        ['coronal', 'volume'],
      ],
    };

    const configFileName = 'layout-grid-config.json';
    await writeManifestToFile(config, configFileName);

    const manifest = {
      resources: [
        { url: `/tmp/${configFileName}` },
        {
          url: 'https://data.kitware.com/api/v1/file/6566aa81c5a2b36857ad1783/download',
          name: 'CT000085.dcm',
        },
      ],
    };

    const manifestFileName = 'layout-grid-manifest.json';
    await writeManifestToFile(manifest, manifestFileName);

    await volViewPage.open(`?urls=[tmp/${manifestFileName}]`);
    await volViewPage.waitForViews();

    await browser.waitUntil(
      async () => {
        const views2D = await volViewPage.getViews2D();
        const view3D = await volViewPage.getView3D();
        return (await views2D.length) === 3 && view3D !== null;
      },
      {
        timeout: DOWNLOAD_TIMEOUT,
        timeoutMsg: 'Expected 3 2D views and 1 3D view',
        interval: 1000,
      }
    );

    const views2D = await volViewPage.getViews2D();
    const view3D = await volViewPage.getView3D();

    expect(await views2D.length).toBe(3);
    expect(view3D).not.toBeNull();
  });

  it('should create a single row layout', async () => {
    const config = {
      layout: [['axial', 'coronal', 'sagittal']],
    };

    const configFileName = 'layout-single-row-config.json';
    await writeManifestToFile(config, configFileName);

    const manifest = {
      resources: [
        { url: `/tmp/${configFileName}` },
        {
          url: 'https://data.kitware.com/api/v1/file/6566aa81c5a2b36857ad1783/download',
          name: 'CT000085.dcm',
        },
      ],
    };

    const manifestFileName = 'layout-single-row-manifest.json';
    await writeManifestToFile(manifest, manifestFileName);

    await volViewPage.open(`?urls=[tmp/${manifestFileName}]`);
    await volViewPage.waitForViews();

    await browser.waitUntil(
      async () => {
        const views2D = await volViewPage.getViews2D();
        const view3D = await volViewPage.getView3D();
        return (await views2D.length) === 3 && view3D === null;
      },
      {
        timeout: DOWNLOAD_TIMEOUT,
        timeoutMsg: 'Expected 3 2D views and no 3D view',
        interval: 1000,
      }
    );

    const views2D = await volViewPage.getViews2D();
    const view3D = await volViewPage.getView3D();

    expect(await views2D.length).toBe(3);
    expect(view3D).toBeNull();
  });

  it('should create an asymmetric nested layout', async () => {
    const config = {
      layout: {
        direction: 'H',
        items: [
          'volume',
          {
            direction: 'V',
            items: ['axial', 'coronal', 'sagittal'],
          },
        ],
      },
    };

    const configFileName = 'layout-nested-config.json';
    await writeManifestToFile(config, configFileName);

    const manifest = {
      resources: [
        { url: `/tmp/${configFileName}` },
        {
          url: 'https://data.kitware.com/api/v1/file/6566aa81c5a2b36857ad1783/download',
          name: 'CT000085.dcm',
        },
      ],
    };

    const manifestFileName = 'layout-nested-manifest.json';
    await writeManifestToFile(manifest, manifestFileName);

    await volViewPage.open(`?urls=[tmp/${manifestFileName}]`);
    await volViewPage.waitForViews();

    await browser.waitUntil(
      async () => {
        const views2D = await volViewPage.getViews2D();
        const view3D = await volViewPage.getView3D();
        return (await views2D.length) === 3 && view3D !== null;
      },
      {
        timeout: DOWNLOAD_TIMEOUT,
        timeoutMsg: 'Expected 3 2D views and 1 3D view',
        interval: 1000,
      }
    );

    const views2D = await volViewPage.getViews2D();
    const view3D = await volViewPage.getView3D();

    expect(await views2D.length).toBe(3);
    expect(view3D).not.toBeNull();
  });

  it('should create layout with custom view options', async () => {
    const config = {
      layout: {
        direction: 'H',
        items: [
          {
            type: '3D',
            name: 'Top View',
            viewDirection: 'Superior',
            viewUp: 'Anterior',
          },
          {
            direction: 'V',
            items: [
              {
                type: '2D',
                orientation: 'Axial',
              },
              {
                type: '2D',
                orientation: 'Coronal',
              },
            ],
          },
        ],
      },
    };

    const configFileName = 'layout-custom-views-config.json';
    await writeManifestToFile(config, configFileName);

    const manifest = {
      resources: [
        { url: `/tmp/${configFileName}` },
        {
          url: 'https://data.kitware.com/api/v1/file/6566aa81c5a2b36857ad1783/download',
          name: 'CT000085.dcm',
        },
      ],
    };

    const manifestFileName = 'layout-custom-views-manifest.json';
    await writeManifestToFile(manifest, manifestFileName);

    await volViewPage.open(`?urls=[tmp/${manifestFileName}]`);
    await volViewPage.waitForViews();

    await browser.waitUntil(
      async () => {
        const views2D = await volViewPage.getViews2D();
        const view3D = await volViewPage.getView3D();
        return (await views2D.length) === 2 && view3D !== null;
      },
      {
        timeout: DOWNLOAD_TIMEOUT,
        timeoutMsg: 'Expected 2 2D views and 1 3D view',
        interval: 1000,
      }
    );

    const views2D = await volViewPage.getViews2D();
    const view3D = await volViewPage.getView3D();

    expect(await views2D.length).toBe(2);
    expect(view3D).not.toBeNull();
  });
});
