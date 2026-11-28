import { test, expect } from '../fixtures';
import { PROSTATEX_DATASET } from '../datasets';

test.describe('VolView Layout Configuration', () => {
  test('should create a 2x2 grid layout from simple string array', async ({
    volview,
    configUtils,
  }) => {
    const config = {
      layouts: {
        default: [
          ['axial', 'sagittal'],
          ['coronal', 'volume'],
        ],
      },
    };

    await configUtils.openConfigAndDataset(config, 'layout-grid');

    await volview.waitForViewCounts(3, true);
  });

  test('should create an asymmetric nested layout', async ({
    volview,
    configUtils,
  }) => {
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

    await configUtils.openConfigAndDataset(config, 'layout-nested');

    await volview.waitForViewCounts(3, true);
  });

  test('should create layout with custom view options', async ({
    volview,
    configUtils,
  }) => {
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

    await configUtils.openConfigAndDataset(config, 'layout-custom-views');

    await volview.waitForViewCounts(2, true);
  });

  test('should support multiple named layouts and preserve slice selection', async ({
    volview,
    configUtils,
  }) => {
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

    await configUtils.openConfigAndDataset(
      config,
      'multiple-layouts',
      PROSTATEX_DATASET
    );

    await volview.waitForViewCounts(4, false);

    await volview.focusFirst2DView();

    const initialSlice = await volview.getFirst2DSlice();
    expect(initialSlice).not.toBeUndefined();

    await volview.advanceSliceAndWait();

    const sliceAfterScroll = await volview.getFirst2DSlice();
    expect(sliceAfterScroll).not.toBeUndefined();
    if (initialSlice !== undefined && sliceAfterScroll !== undefined) {
      expect(sliceAfterScroll).toBeLessThan(initialSlice);
    }

    await volview.openLayoutMenu(3);
    const layoutTitles = await volview.getLayoutOptionTitles();
    expect(layoutTitles).toEqual(
      expect.arrayContaining(['Four Up Axial', 'Single Axial', 'Dual Axial'])
    );

    await volview.selectLayoutOption('Single Axial');
    await volview.waitForViewCounts(1, false);

    await volview.focusFirst2DView();
    const sliceAfterLayoutSwitch = await volview.getFirst2DSlice();
    expect(sliceAfterLayoutSwitch).toBe(sliceAfterScroll);

    await volview.openLayoutMenu(3);
    await volview.selectLayoutOption('Dual Axial');
    await volview.waitForViewCounts(2, false);

    await volview.focusFirst2DView();
    const sliceInFirstViewAfterDualSwitch = await volview.getFirst2DSlice();
    expect(sliceInFirstViewAfterDualSwitch).toBe(sliceAfterScroll);
  });

  test('should disable configured view types', async ({
    page,
    volview,
    configUtils,
  }) => {
    const config = {
      disabledViewTypes: ['3D', 'Oblique', 'EnFace'],
    };

    await configUtils.openConfigAndDataset(config, 'disabled-view-types');

    await volview.waitForViewCounts(4, false);

    const viewTypeSwitchers = page.locator('.view-type-select');
    expect(await viewTypeSwitchers.count()).toBeGreaterThan(0);

    const firstSwitcher = viewTypeSwitchers.first();
    await firstSwitcher.click();

    const optionTexts = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.v-list-item-title'));
      return items.map((item) => item.textContent?.trim() ?? '');
    });

    expect(optionTexts).not.toContain('Volume');
    expect(optionTexts).not.toContain('Oblique');
    expect(optionTexts).not.toContain('En face');
    expect(optionTexts).toContain('Axial');
    expect(optionTexts).toContain('Coronal');
    expect(optionTexts).toContain('Sagittal');
  });
});
