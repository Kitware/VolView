import * as path from 'path';
import { readFileSync } from 'node:fs';
import dicomParser from 'dicom-parser';
import { TEMP_DIR } from '@/wdio.shared.conf';
import { PET_CT_DICOM_DATASETS } from '../datasets';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  capture2DViewScreenshotMetrics,
  selectLayout,
  waitForModuleTransitions,
} from './utils';

async function captureAxialPixels() {
  return (await capture2DViewScreenshotMetrics('pet-ct-capture.png'))[0];
}

async function reopenSample(
  expected: Awaited<ReturnType<typeof captureAxialPixels>>
) {
  await $('[data-testid="module-tab-Data"]').click();
  await waitForModuleTransitions();
  const samplesSection = $('.v-expansion-panel-title*=Sample Data');
  if ((await samplesSection.getAttribute('aria-expanded')) === 'true') {
    await samplesSection.click();
    await expect(samplesSection).toHaveAttribute('aria-expanded', 'false');
    await waitForModuleTransitions();
  }
  await samplesSection.click();
  await expect(samplesSection).toHaveAttribute('aria-expanded', 'true');
  const sample = volViewPage.samplesList.$('[title="PET/CT Chest"]');
  await sample.waitForExist();
  await waitForModuleTransitions();
  await sample.scrollIntoView({ block: 'center', behavior: 'instant' });
  await browser.saveScreenshot(path.join(TEMP_DIR, 'pet-ct-sample-reload.png'));
  await sample.waitForClickable();
  await sample.click();
  await sample.$('.mdi-check').waitForExist();
  await volViewPage.waitForViewCounts(1, false);
  await volViewPage.renderingModuleTab.click();
  await expect($$('h4*=PET WB Corrected')).toBeElementsArrayOfSize(1);
  for (const control of [
    'layer-colormap',
    'layer-transparent-background',
    'layer-range-min',
    'layer-range-max',
    'layer-opacity-slider',
  ])
    await expect($$(`[data-testid="${control}"]`)).toBeElementsArrayOfSize(1);
  await expect($('[data-testid="layer-range-min"] input')).toHaveAttribute(
    'title',
    '0'
  );
  await expect($('[data-testid="layer-range-max"] input')).toHaveAttribute(
    'title',
    '8000'
  );
  await expect(
    $('[data-testid="layer-transparent-background"] input')
  ).toBeChecked();
  await expect(
    $('[data-testid="layer-opacity-slider"] [role="slider"]')
  ).toHaveAttribute('aria-valuenow', '0.45');
  await $('header').moveTo();
  await browser.waitUntil(
    async () => {
      const pixels = await captureAxialPixels();
      return (
        pixels.colored === expected.colored &&
        pixels.blue === expected.blue &&
        pixels.checksum === expected.checksum
      );
    },
    {
      timeoutMsg:
        'Expected reopening the sample to restore exactly one PET overlay with its original appearance',
    }
  );
}

describe('PET/CT sample', () => {
  before(async () => {
    await browser.addInitScript(
      (datasets) => {
        const localUrls = new Map(
          datasets.map(({ url, name }) => [url, `/tmp/${name}`])
        );
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          const local = localUrls.get(url);
          if (!local) return originalFetch(input, init);
          const mapped =
            input instanceof Request ? new Request(local, input) : local;
          return originalFetch(mapped, init);
        };
      },
      PET_CT_DICOM_DATASETS.map(({ url, name }) => ({ url, name }))
    );
  });

  it('preserves Four Up when loading and reopening the sample', async () => {
    const ctFile = PET_CT_DICOM_DATASETS.find(({ name }) =>
      name.startsWith('PET-CT-CT-')
    )!;
    const tags = dicomParser.parseDicom(
      new Uint8Array(readFileSync(path.join(TEMP_DIR, ctFile.name)))
    );
    const width = Number(tags.string('x00281051')!.split('\\')[0]);
    const level = Number(tags.string('x00281050')!.split('\\')[0]);
    expect(width).toBeGreaterThan(0);
    expect(Number.isFinite(level)).toBe(true);
    await volViewPage.open();
    await selectLayout('Four Up', 3, true);
    for (let loading = 0; loading < 2; loading++) {
      await $('[data-testid="module-tab-Data"]').click();
      await waitForModuleTransitions();
      const samplesSection = $('.v-expansion-panel-title*=Sample Data');
      if ((await samplesSection.getAttribute('aria-expanded')) !== 'true') {
        await samplesSection.click();
        await expect(samplesSection).toHaveAttribute('aria-expanded', 'true');
        await waitForModuleTransitions();
      }
      const sample = volViewPage.samplesList.$('[title="PET/CT Chest"]');
      await sample.scrollIntoView({ block: 'center', behavior: 'instant' });
      await sample.waitForClickable();
      await sample.click();
      await expect($('[data-testid~="vtk-two-view"]')).toHaveText(
        expect.stringContaining('CT WB')
      );
      await volViewPage.renderingModuleTab.click();
      await expect($('h4*=PET WB Corrected')).toBeDisplayed();
      await expect($('[data-testid="layer-range-max"] input')).toHaveAttribute(
        'title',
        '8000'
      );
      await volViewPage.waitForViewCounts(3, true);
      const slices = $$('[data-testid~="vtk-two-view"]');
      for (const view of await slices) {
        await expect(view).toHaveText(expect.stringContaining('CT WB'));
        await expect(view).toHaveText(
          expect.stringContaining(
            `W/L: ${width.toFixed(2)} / ${level.toFixed(2)}`
          )
        );
      }
      await volViewPage.layoutButton.click();
      await expect($('.v-list-item--active .v-list-item-title')).toHaveText(
        'Four Up'
      );
      await browser.keys('Escape');
      await waitForModuleTransitions();
      if (loading === 0) {
        const maximum = $('[data-testid="layer-range-max"] input');
        await maximum.scrollIntoView({ block: 'center', behavior: 'instant' });
        await setValueVueInput(maximum, '4000');
        await expect(maximum).toHaveAttribute('title', '4000');
      }
    }
  });

  it('keeps one PET overlay when reopening the sample and retains edited colors across layouts', async () => {
    await volViewPage.open();
    await selectLayout('Axial Only', 1, false);
    const sample = volViewPage.samplesList.$('[title="PET/CT Chest"]');
    await sample.scrollIntoView();
    await sample.waitForClickable();
    await sample.click();
    await volViewPage.waitForViews();
    await volViewPage.waitForViewCounts(1, false);
    const view = $('[data-testid~="vtk-two-view"]');
    await expect(view).toHaveText(expect.stringContaining('CT WB'));
    await expect(view).toHaveText(expect.stringContaining('Slice: 6/10'));

    await volViewPage.renderingModuleTab.click();
    for (const title of ['Color Presets', 'Cinematic Rendering']) {
      const section = $(`.v-expansion-panel-title*=${title}`);
      if (
        (await section.isExisting()) &&
        (await section.getAttribute('aria-expanded')) === 'true'
      )
        await section.click();
    }
    const palette = $('[data-testid="layer-colormap"]');
    await palette.waitForDisplayed();
    await expect(palette).toHaveText(expect.stringContaining('DICOM Hot Iron'));
    await expect(palette).not.toHaveText(
      expect.stringContaining('2hot-opaque')
    );
    await expect($('h4*=PET')).toBeDisplayed();
    await expect($('[data-testid="layer-range-min"] input')).toBeEnabled();
    await expect($('[data-testid="layer-range-max"] input')).toBeEnabled();
    const minimum = await $('[data-testid="layer-range-min"] input').getValue();
    const maximum = await $('[data-testid="layer-range-max"] input').getValue();
    const opacity = '0.45';
    expect(minimum).toBe('0');
    expect(maximum).toBe('8000');
    await expect(
      $('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', opacity);
    await expect($('[data-testid="layer-range-min"] input')).toHaveAttribute(
      'title',
      '0'
    );
    await expect($('[data-testid="layer-range-max"] input')).toHaveAttribute(
      'title',
      '8000'
    );
    await expect(
      $('[data-testid="layer-transparent-background"] input')
    ).toBeChecked();
    await browser.waitUntil(
      async () => (await captureAxialPixels()).colored > 1000,
      {
        timeoutMsg:
          'Expected the PET layer to be visible over the CT immediately after loading the sample',
      }
    );
    const initial = await captureAxialPixels();
    await browser.saveScreenshot(path.join(TEMP_DIR, 'pet-ct-sample.png'));
    await view.$('canvas').click();
    await browser.keys('ArrowDown');
    await expect(view).toHaveText(expect.stringContaining('Slice: 5/10'));
    await browser.waitUntil(
      async () => (await captureAxialPixels()).checksum !== initial.checksum,
      {
        timeoutMsg:
          'Expected moving to an adjacent slice to change the displayed image',
      }
    );
    await browser.keys('ArrowUp');
    await expect(view).toHaveText(expect.stringContaining('Slice: 6/10'));
    await browser.waitUntil(
      async () => (await captureAxialPixels()).checksum === initial.checksum,
      {
        timeoutMsg:
          'Expected returning to the middle slice to restore its image',
      }
    );

    await palette.scrollIntoView({ block: 'center', behavior: 'instant' });
    await palette.click();
    await expect($('[role="option"]=DICOM Hot Iron')).toExist();
    await expect($('[role="option"]=Heat')).not.toExist();
    await expect($('[role="option"]=2hot-opaque')).not.toExist();
    const coolToWarm = $('[role="option"]*=Cool to Warm');
    await coolToWarm.scrollIntoView({ block: 'center', behavior: 'instant' });
    await coolToWarm.waitForClickable();
    await coolToWarm.click();
    await $('header').moveTo();
    await browser.waitUntil(
      async () => {
        const pixels = await captureAxialPixels();
        return pixels.colored > 1000 && pixels.checksum !== initial.checksum;
      },
      {
        timeoutMsg:
          'Expected the selected palette to change the visible PET colors',
      }
    );
    const beforeRange = await captureAxialPixels();
    const narrowedMaximum = String((Number(minimum) + Number(maximum)) / 2);
    await setValueVueInput(
      $('[data-testid="layer-range-max"] input'),
      narrowedMaximum
    );
    await $('header').moveTo();
    await expect($('[data-testid="layer-range-min"] input')).toHaveAttribute(
      'title',
      minimum
    );
    await expect($('[data-testid="layer-range-max"] input')).toHaveAttribute(
      'title',
      narrowedMaximum
    );
    await browser.waitUntil(
      async () => {
        const pixels = await captureAxialPixels();
        return (
          pixels.colored > 1000 && pixels.checksum !== beforeRange.checksum
        );
      },
      {
        timeoutMsg:
          'Expected narrowing the PET range to change the visible colored regions',
      }
    );
    const edited = await captureAxialPixels();

    await selectLayout('3D Only', 0, true);
    await expect($('[data-testid="layer-range-max"] input')).toBeDisabled();
    await selectLayout('Axial Only', 1, false);
    await expect($('[data-testid="layer-range-min"] input')).toHaveValue(
      minimum
    );
    await expect($('[data-testid="layer-range-max"] input')).toHaveValue(
      narrowedMaximum
    );
    await expect(palette).toHaveText(expect.stringContaining('Cool to Warm'));
    await expect(
      $('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', opacity);
    await $('header').moveTo();
    await browser.waitUntil(
      async () => {
        const pixels = await captureAxialPixels();
        return pixels.blue === edited.blue && pixels.colored === edited.colored;
      },
      {
        timeoutMsg:
          'Expected the edited PET overlay to render identically after replacing the axial view',
      }
    );
    await browser.saveScreenshot(
      path.join(TEMP_DIR, 'pet-ct-sample-edited.png')
    );
    for (let reopening = 0; reopening < 2; reopening++) {
      await setValueVueInput(
        $('[data-testid="layer-range-max"] input'),
        narrowedMaximum
      );
      await expect($('[data-testid="layer-range-max"] input')).toHaveAttribute(
        'title',
        narrowedMaximum
      );
      await reopenSample(initial);
    }
    await browser.saveScreenshot(
      path.join(TEMP_DIR, 'pet-ct-sample-reopened.png')
    );
    await $('[data-testid="module-tab-Data"]').click();
    const petCard = $('.volume-card[html-title="PET WB Corrected"]');
    await petCard.waitForDisplayed();
    await waitForModuleTransitions();
    const petMenu = petCard.$('[data-testid="dataset-menu-button"]');
    await petMenu.scrollIntoView({ block: 'center', behavior: 'instant' });
    await petMenu.waitForClickable();
    await petMenu.click();
    const deleteItem = $('.v-list-item=Delete');
    await deleteItem.waitForClickable();
    await deleteItem.click();
    await expect(petCard).not.toExist();
    await expect($('.volume-card[html-title="CT WB  1.0  B30f"]')).toExist();
    await reopenSample(initial);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
