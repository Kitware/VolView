import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  openUrls,
  openVolViewPage,
  writeManifestToFile,
  writeMetaImage,
} from './utils';
import { openConfigAndDataset } from './configTestUtils';
import { ONE_CT_SLICE_DICOM, MINIMAL_DICOM } from '../datasets';
import { displayedWindow } from './octTestUtils';

async function setManualWindow(
  view: WebdriverIO.Element,
  width: number,
  level: number
) {
  await view.$('canvas').click();
  await $('button[data-testid^="control-button-Window & Level "]').click();
  const inputs = $$('.v-overlay--active .manual-inputs input');
  await inputs[0].waitForDisplayed();
  await inputs[0].waitForStable();
  await inputs[0].waitForClickable();
  await setValueVueInput(inputs[0], String(width));
  await setValueVueInput(inputs[1], String(level));
  await browser.keys('Tab');
  await browser.keys('Escape');
  await inputs[0].waitForDisplayed({ reverse: true });
  expect(await displayedWindow(view)).toEqual({ width, level });
}

const expectWindowLevel = async (width: number, level: number) => {
  const view = $('div[data-testid="vtk-view vtk-two-view"]');
  await volViewPage.waitForLoadingIndicator(view);
  await expect(view.$('.view-annotations')).toHaveText(
    expect.stringContaining(`W/L: ${width.toFixed(2)} / ${level.toFixed(2)}`)
  );
};

describe('VolView windowing configuration', () => {
  it('should use runtime config window level over DICOM window level', async () => {
    const runtimeWindowLevel = {
      width: 2000,
      level: 1000,
    };

    const config = {
      windowing: runtimeWindowLevel,
    };

    await openConfigAndDataset(config, 'windowing');
    await expectWindowLevel(runtimeWindowLevel.width, runtimeWindowLevel.level);
  });

  it('should use DICOM window level when no runtime config is provided', async () => {
    await openUrls([ONE_CT_SLICE_DICOM]);
    await expectWindowLevel(410, 70);
  });

  it('should use auto windowing for DICOM without window/level metadata', async () => {
    await openUrls([MINIMAL_DICOM]);
    await expectWindowLevel(1900, 1050);
  });

  it('retains synchronized source contrast when a peer returns from another dataset', async () => {
    const source = writeMetaImage('windowing-source.mha');
    const other = writeMetaImage('windowing-other.mha', { step: 29 });
    const manifest = 'windowing-dataset-switch.json';
    await writeManifestToFile(
      {
        resources: [source, other].map((name) => ({
          url: '/tmp/' + name,
          name,
        })),
      },
      manifest
    );
    await openVolViewPage(manifest);
    await volViewPage.waitForViewCounts(3, true);
    await $('button[data-testid="module-tab-Data"]').click();
    const sourceCard = $('.image-list-card:has([title="' + source + '"])');
    const otherCard = $('.image-list-card:has([title="' + other + '"])');
    await sourceCard.waitForDisplayed();
    await otherCard.waitForDisplayed();
    await sourceCard.$('[data-testid="dataset-menu-button"]').click();
    const showAll = $(
      '//div[contains(@class,"v-overlay--active")]//div[contains(@class,"v-list-item") and normalize-space(.)="Show in all views"]'
    );
    await showAll.waitForClickable();
    await showAll.click();
    await browser.keys('Escape');
    await showAll.waitForDisplayed({ reverse: true });

    const views = await volViewPage.getViews2D();
    const origin = await views[0].getElement();
    const peer = await views[1].getElement();
    await expect(origin).toHaveText(expect.stringContaining(source));
    await setManualWindow(origin, 160, 120);
    expect(await displayedWindow(peer)).toEqual({ width: 160, level: 120 });
    await peer.$('canvas').click();
    await otherCard.click();
    await expect(peer).toHaveText(expect.stringContaining(other));
    const otherWindow = await displayedWindow(peer);

    await setManualWindow(origin, 80, 60);
    expect(await displayedWindow(peer)).toEqual(otherWindow);

    await peer.$('canvas').click();
    await sourceCard.click();
    await expect(peer).toHaveText(expect.stringContaining(source));
    await browser.waitUntil(
      async () => {
        const current = await displayedWindow(peer);
        return current.width === 80 && current.level === 60;
      },
      {
        timeoutMsg:
          'A peer returning to the source must retain its synchronized contrast',
      }
    );
  });
});
