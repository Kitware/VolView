import { volViewPage } from '../pageobjects/volview.page';
import { writeManifestToFile } from './utils';

const SAMPLE_DICOM_URL =
  'https://data.kitware.com/api/v1/file/6566aa81c5a2b36857ad1783/download';
const SAMPLE_DICOM_NAME = 'CT000085.dcm';

const PROSTATEX_DATASET = {
  url: 'https://data.kitware.com/api/v1/item/63527c7311dab8142820a338/download',
  name: 'MRI-PROSTATEx-0004.zip',
};

type DatasetResource = {
  url: string;
  name?: string;
};

const DEFAULT_DATASET: DatasetResource = {
  url: SAMPLE_DICOM_URL,
  name: SAMPLE_DICOM_NAME,
};

const createConfigManifest = async (
  config: unknown,
  configFileName: string,
  manifestFileName: string,
  dataset: DatasetResource = DEFAULT_DATASET
) => {
  await writeManifestToFile(config, configFileName);

  const manifest = {
    resources: [{ url: `/tmp/${configFileName}` }, dataset],
  };

  await writeManifestToFile(manifest, manifestFileName);
  return manifestFileName;
};

const expectViewCounts = async (
  expected2DCount: number,
  expected3DExists: boolean
) => {
  const views2D = await volViewPage.getViews2D();
  const view3D = await volViewPage.getView3D();
  const views2DCount = await views2D.length;

  expect(views2DCount).toBe(expected2DCount);
  expect(view3D !== null).toBe(expected3DExists);
};

const openConfigAndWait = async (
  config: unknown,
  configFileName: string,
  manifestFileName: string,
  dataset: DatasetResource = DEFAULT_DATASET
) => {
  const manifestFileNameOnDisk = await createConfigManifest(
    config,
    configFileName,
    manifestFileName,
    dataset
  );

  await volViewPage.open(`?urls=[tmp/${manifestFileNameOnDisk}]`);
  await volViewPage.waitForViews();
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

    await openConfigAndWait(
      config,
      'layout-grid-config.json',
      'layout-grid-manifest.json'
    );

    await volViewPage.waitForViewCounts(3, true);
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

    await openConfigAndWait(
      config,
      'layout-nested-config.json',
      'layout-nested-manifest.json'
    );

    await volViewPage.waitForViewCounts(3, true);
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

    await openConfigAndWait(
      config,
      'layout-custom-views-config.json',
      'layout-custom-views-manifest.json'
    );

    await volViewPage.waitForViewCounts(2, true);
    await expectViewCounts(2, true);
  });

  it('should support multiple named layouts and preserve slice selection', async () => {
    const config = {
      layouts: {
        'Four Up Axial': [
          ['axial', 'sagittal'],
          ['coronal', 'axial'],
        ],
        'Single Axial': [['axial']],
        'Dual Axial': [['axial'], ['axial']],
      },
    };

    await openConfigAndWait(
      config,
      'multiple-layouts-config.json',
      'multiple-layouts-manifest.json',
      PROSTATEX_DATASET
    );

    await volViewPage.waitForViewCounts(4, false);
    await expectViewCounts(4, false);

    await volViewPage.focusFirst2DView();

    const initialSlice = await volViewPage.getFirst2DSlice();
    expect(initialSlice).not.toBeNull();

    await volViewPage.advanceSlice();
    await volViewPage.waitForSliceIncrease(initialSlice);

    const sliceAfterScroll = await volViewPage.getFirst2DSlice();
    expect(sliceAfterScroll).not.toBeNull();
    if (initialSlice !== null && sliceAfterScroll !== null) {
      expect(sliceAfterScroll).toBeGreaterThan(initialSlice);
    }

    await volViewPage.openLayoutMenu(3);
    const layoutTitles = await volViewPage.getLayoutOptionTitles();
    expect(layoutTitles).toEqual(
      expect.arrayContaining(['Four Up Axial', 'Single Axial', 'Dual Axial'])
    );

    await volViewPage.selectLayoutOption('Single Axial');
    await volViewPage.waitForViewCounts(1, false);

    await volViewPage.focusFirst2DView();
    const sliceAfterLayoutSwitch = await volViewPage.getFirst2DSlice();
    expect(sliceAfterLayoutSwitch).toBe(sliceAfterScroll);

    await volViewPage.openLayoutMenu(3);
    await volViewPage.selectLayoutOption('Dual Axial');
    await volViewPage.waitForViewCounts(2, false);

    await volViewPage.focusFirst2DView();
    const sliceInFirstViewAfterDualSwitch = await volViewPage.getFirst2DSlice();
    expect(sliceInFirstViewAfterDualSwitch).toBe(sliceAfterScroll);
  });

  it('should disable 3D and Oblique view types', async () => {
    const config = {
      disabledViewTypes: ['3D', 'Oblique'],
    };

    await openConfigAndWait(
      config,
      'disabled-view-types-config.json',
      'disabled-view-types-manifest.json'
    );

    await volViewPage.waitForViewCounts(4, false);
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
