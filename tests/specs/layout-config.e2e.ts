import { volViewPage } from '../pageobjects/volview.page';
import { DOWNLOAD_TIMEOUT } from '../../wdio.shared.conf';
import { writeManifestToFile } from './utils';

const SAMPLE_DICOM_URL =
  'https://data.kitware.com/api/v1/file/6566aa81c5a2b36857ad1783/download';
const SAMPLE_DICOM_NAME = 'CT000085.dcm';

const createConfigManifest = async (
  config: unknown,
  configFileName: string,
  manifestFileName: string
) => {
  await writeManifestToFile(config, configFileName);

  const manifest = {
    resources: [
      { url: `/tmp/${configFileName}` },
      {
        url: SAMPLE_DICOM_URL,
        name: SAMPLE_DICOM_NAME,
      },
    ],
  };

  await writeManifestToFile(manifest, manifestFileName);
  return manifestFileName;
};

const waitForViewCounts = async (
  expected2DCount: number,
  expected3DExists: boolean,
  timeout = DOWNLOAD_TIMEOUT
) => {
  await browser.waitUntil(
    async () => {
      const views2D = await volViewPage.getViews2D();
      const view3D = await volViewPage.getView3D();
      return (
        (await views2D.length) === expected2DCount &&
        (view3D !== null) === expected3DExists
      );
    },
    {
      timeout,
      timeoutMsg: `Expected ${expected2DCount} 2D views and ${
        expected3DExists ? 'a' : 'no'
      } 3D view`,
      interval: 1000,
    }
  );
};

const expectViewCounts = async (
  expected2DCount: number,
  expected3DExists: boolean
) => {
  const views2D = await volViewPage.getViews2D();
  const view3D = await volViewPage.getView3D();

  expect(await views2D.length).toBe(expected2DCount);
  if (expected3DExists) {
    expect(view3D).not.toBeNull();
  } else {
    expect(view3D).toBeNull();
  }
};

describe('VolView Layout Configuration', () => {
  it('should create a 2x2 grid layout from simple string array', async () => {
    const config = {
      layouts: {
        default: [
          ['axial', 'sagittal'],
          ['coronal', 'volume'],
        ],
      },
    };

    const manifestFileName = await createConfigManifest(
      config,
      'layout-grid-config.json',
      'layout-grid-manifest.json'
    );

    await volViewPage.open(`?urls=[tmp/${manifestFileName}]`);
    await volViewPage.waitForViews();

    await waitForViewCounts(3, true);
    await expectViewCounts(3, true);
  });

  it('should create an asymmetric nested layout', async () => {
    const config = {
      layouts: {
        default: {
          direction: 'row',
          items: [
            'volume',
            {
              direction: 'column',
              items: ['axial', 'coronal', 'sagittal'],
            },
          ],
        },
      },
    };

    const manifestFileName = await createConfigManifest(
      config,
      'layout-nested-config.json',
      'layout-nested-manifest.json'
    );

    await volViewPage.open(`?urls=[tmp/${manifestFileName}]`);
    await volViewPage.waitForViews();

    await waitForViewCounts(3, true);
    await expectViewCounts(3, true);
  });

  it('should create layout with custom view options', async () => {
    const config = {
      layouts: {
        default: {
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
      },
    };

    const manifestFileName = await createConfigManifest(
      config,
      'layout-custom-views-config.json',
      'layout-custom-views-manifest.json'
    );

    await volViewPage.open(`?urls=[tmp/${manifestFileName}]`);
    await volViewPage.waitForViews();

    await waitForViewCounts(2, true);
    await expectViewCounts(2, true);
  });

  it('should support multiple named layouts', async () => {
    const config = {
      layouts: {
        'quad-view': [
          ['axial', 'sagittal'],
          ['coronal', 'axial'],
        ],
        'triple-view': {
          direction: 'row',
          items: [
            'axial',
            {
              direction: 'column',
              items: ['coronal', 'sagittal'],
            },
          ],
        },
        'single-view': [['axial']],
      },
    };

    const manifestFileName = await createConfigManifest(
      config,
      'multiple-layouts-config.json',
      'multiple-layouts-manifest.json'
    );

    await volViewPage.open(`?urls=[tmp/${manifestFileName}]`);
    await volViewPage.waitForViews();

    await waitForViewCounts(4, false);
    await expectViewCounts(4, false);

    const layoutButton = await $(
      'button[data-testid="control-button-Layouts"]'
    );
    await browser.waitUntil(
      async () => {
        return layoutButton.isDisplayed();
      },
      {
        timeout: 5000,
        timeoutMsg: 'Layout button not displayed',
        interval: 500,
      }
    );
    await layoutButton.click();

    await browser.waitUntil(
      async () => {
        const layoutItems = await $$('.v-list-item');
        return (await layoutItems.length) >= 3;
      },
      {
        timeout: 5000,
        timeoutMsg: 'Expected layout menu to show at least 3 layout options',
        interval: 500,
      }
    );

    const layoutTitles = await browser.execute(() => {
      const items = Array.from(document.querySelectorAll('.v-list-item-title'));
      return items.map((item) => item.textContent?.trim() ?? '');
    });

    expect(layoutTitles).toContain('Quad View');
    expect(layoutTitles).toContain('Triple View');
    expect(layoutTitles).toContain('Single View');

    await browser.execute((targetText: string) => {
      const items = Array.from(document.querySelectorAll('.v-list-item-title'));
      const targetItem = items.find(
        (item) => item.textContent?.trim() === targetText
      );
      if (targetItem) {
        const listItem = targetItem.closest('.v-list-item') as HTMLElement;
        if (listItem) listItem.click();
      }
    }, 'Single View');

    await browser.waitUntil(
      async () => {
        const views2DAfter = await volViewPage.getViews2D();
        return (await views2DAfter.length) === 1;
      },
      {
        timeout: 5000,
        timeoutMsg: 'Expected single-view layout with 1 2D view',
        interval: 500,
      }
    );

    const views2DAfter = await volViewPage.getViews2D();
    expect(await views2DAfter.length).toBe(1);
  });

  it('should disable 3D and Oblique view types', async () => {
    const config = {
      disabledViewTypes: ['3D', 'Oblique'],
    };

    const manifestFileName = await createConfigManifest(
      config,
      'disabled-view-types-config.json',
      'disabled-view-types-manifest.json'
    );

    await volViewPage.open(`?urls=[tmp/${manifestFileName}]`);
    await volViewPage.waitForViews();

    await waitForViewCounts(4, false);
    await expectViewCounts(4, false);

    const viewTypeSwitchers = await $$('.view-type-select');
    expect(viewTypeSwitchers.length).toBeGreaterThan(0);

    const firstSwitcher = viewTypeSwitchers[0];
    await firstSwitcher.click();

    const optionTexts = await browser.execute(() => {
      const items = Array.from(document.querySelectorAll('.v-list-item-title'));
      return items.map((item) => item.textContent?.trim() ?? '');
    });

    expect(optionTexts).not.toContain('Volume');
    expect(optionTexts).not.toContain('Oblique');
    expect(optionTexts).toContain('Axial');
    expect(optionTexts).toContain('Coronal');
    expect(optionTexts).toContain('Sagittal');
  });
});
