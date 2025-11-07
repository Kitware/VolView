import { volViewPage } from '../pageobjects/volview.page';
import { PROSTATEX_DATASET, openConfigAndDataset } from './configTestUtils';

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

    await openConfigAndDataset(config, 'layout-grid');

    await volViewPage.waitForViewCounts(3, true);
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

    await openConfigAndDataset(config, 'layout-nested');

    await volViewPage.waitForViewCounts(3, true);
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

    await openConfigAndDataset(config, 'layout-custom-views');

    await volViewPage.waitForViewCounts(2, true);
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

    await openConfigAndDataset(config, 'multiple-layouts', PROSTATEX_DATASET);

    await volViewPage.waitForViewCounts(4, false);

    await volViewPage.focusFirst2DView();

    const initialSlice = await volViewPage.getFirst2DSlice();
    expect(initialSlice).not.toBeNull();

    await volViewPage.advanceSliceAndWait();

    const sliceAfterScroll = await volViewPage.getFirst2DSlice();
    expect(sliceAfterScroll).not.toBeNull();
    if (initialSlice !== null && sliceAfterScroll !== null) {
      expect(sliceAfterScroll).toBeLessThan(initialSlice);
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

    await openConfigAndDataset(config, 'disabled-view-types');

    await volViewPage.waitForViewCounts(4, false);

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
