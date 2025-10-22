import { volViewPage } from '../pageobjects/volview.page';
import { DOWNLOAD_TIMEOUT } from '../../wdio.shared.conf';
import { writeManifestToFile } from './utils';

describe('VolView Layout Configuration', () => {
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
        direction: 'row',
        items: [
          'volume',
          {
            direction: 'column',
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
        direction: 'column',
        items: [
          {
            type: '3D',
            name: 'Top View',
            viewDirection: 'Superior',
            viewUp: 'Anterior',
          },
          {
            direction: 'row',
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
