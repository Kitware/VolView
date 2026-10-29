import * as path from 'path';
import { readFileSync, writeFileSync } from 'node:fs';
import dicomParser from 'dicom-parser';
import { TEMP_DIR } from '@/wdio.shared.conf';
import { PET_CT_DICOM_DATASETS } from '../datasets';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  capture2DViewScreenshotMetrics,
  makeTempDir,
  openVolViewPage,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  selectLayout,
  waitForModuleTransitions,
} from './utils';

async function captureAxialPixels() {
  return (await capture2DViewScreenshotMetrics('pet-ct-capture.png'))[0];
}

let samplePreload:
  | Awaited<ReturnType<typeof browser.addInitScript>>
  | undefined;

async function useLocalSampleFiles(files: { url: string; name: string }[]) {
  await samplePreload?.remove();
  samplePreload = await browser.addInitScript((datasets) => {
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
  }, files);
}

async function openAxialSample() {
  await volViewPage.open();
  await selectLayout('Axial Only', 1, false);
  const sample = volViewPage.samplesList.$('[title="PET/CT Chest"]');
  await sample.scrollIntoView();
  await sample.waitForClickable();
  await sample.click();
  await volViewPage.waitForViews();
}

async function displayedPetRange() {
  return Promise.all(
    ['min', 'max'].map(
      async (endpoint) =>
        (await $(`[data-testid="layer-range-${endpoint}"] input`).getAttribute(
          'title'
        ))!
    )
  );
}

async function expectFullRangeDefault() {
  const initial = await displayedPetRange();
  const contrast = $('[data-testid="layer-contrast"]');
  await contrast.scrollIntoView({ block: 'center', behavior: 'instant' });
  await contrast.click();
  const full = $('[data-testid="layer-contrast-FullRange"]');
  await full.waitForClickable();
  await full.click();
  await browser.waitUntil(
    async () => !(await $('[data-testid="layer-contrast-menu"]').isDisplayed())
  );
  expect(await displayedPetRange()).toEqual(initial);
  return initial;
}

async function openAxialPetLayer() {
  await openAxialSample();
  await volViewPage.waitForViewCounts(1, false);
  await volViewPage.renderingModuleTab.click();
  await $('[data-testid="layer-range-max"] input').waitForEnabled();
  await waitForModuleTransitions();
  await $('header').moveTo();
  const initialPixels = await browser.waitUntil(
    async () => {
      const pixels = await captureAxialPixels();
      return pixels.colored > 1000 ? pixels : false;
    },
    { timeoutMsg: 'Expected the sample to display PET over CT' }
  );
  return {
    pixels: initialPixels,
    range: await displayedPetRange(),
  };
}

async function editPetColors(
  initial: Awaited<ReturnType<typeof captureAxialPixels>>,
  [minimum, maximum]: string[]
) {
  const palette = $('[data-testid="layer-colormap"]');
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
  const beforeRange = await browser.waitUntil(
    async () => {
      const pixels = await captureAxialPixels();
      return pixels.colored > 1000 && pixels.checksum !== initial.checksum
        ? pixels
        : false;
    },
    {
      timeoutMsg:
        'Expected the selected palette to change the visible PET colors',
    }
  );
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
  const editedPixels = await browser.waitUntil(
    async () => {
      const pixels = await captureAxialPixels();
      return pixels.colored > 1000 && pixels.checksum !== beforeRange.checksum
        ? pixels
        : false;
    },
    {
      timeoutMsg:
        'Expected narrowing the PET range to change the visible colored regions',
    }
  );
  return {
    pixels: editedPixels,
    range: [minimum, narrowedMaximum],
  };
}

async function reopenSample(
  expected: Awaited<ReturnType<typeof captureAxialPixels>>,
  range: string[],
  preset = 'DICOM Hot Iron'
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
    range[0]
  );
  await expect($('[data-testid="layer-range-max"] input')).toHaveAttribute(
    'title',
    range[1]
  );
  await expect($('[data-testid="layer-colormap"]')).toHaveText(
    expect.stringContaining(preset)
  );
  await expect(
    $('[data-testid="layer-transparent-background"] input')
  ).toBeChecked();
  await expect(
    $('[data-testid="layer-opacity-slider"] [role="slider"]')
  ).toHaveAttribute('aria-valuenow', '0.5');
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
        'Expected reopening the sample to restore exactly one PET overlay with its expected appearance',
    }
  );
}

async function openPetMetadataVariant(
  variant: 'valid' | 'different' | 'missing' | 'invalid'
) {
  const directory = makeTempDir(`pet-window-${variant}`);
  const petFiles = PET_CT_DICOM_DATASETS.filter(({ name }) =>
    name.startsWith('PET-CT-PT-')
  );
  for (const [index, { name }] of petFiles.entries()) {
    const bytes = Buffer.from(readFileSync(path.join(TEMP_DIR, name)));
    const dataset = dicomParser.parseDicom(bytes);
    for (const [tag, value] of [
      ['x00281050', '3000'],
      ['x00281051', '6000'],
    ]) {
      const element = dataset.elements[tag];
      let replacement = value;
      if (index === petFiles.length - 1 && tag === 'x00281051') {
        if (variant === 'different') replacement = '7000';
        if (variant === 'invalid') replacement = '0';
        if (variant === 'missing')
          bytes.writeUInt16LE(0x7777, element.dataOffset - 8);
      }
      expect(replacement.length).toBeLessThanOrEqual(element.length);
      bytes.write(
        replacement.padEnd(element.length, ' '),
        element.dataOffset,
        element.length,
        'ascii'
      );
    }
    writeFileSync(path.join(directory, name), bytes);
  }
  await useLocalSampleFiles(
    PET_CT_DICOM_DATASETS.map((file) => ({
      url: file.url,
      name: file.name.startsWith('PET-CT-PT-')
        ? `pet-window-${variant}/${file.name}`
        : file.name,
    }))
  );
  await openAxialSample();
  await volViewPage.renderingModuleTab.click();
  await $('[data-testid="layer-range-max"] input').waitForEnabled();
  await waitForModuleTransitions();
}

describe('PET/CT sample', () => {
  before(async () => {
    await useLocalSampleFiles(PET_CT_DICOM_DATASETS);
  });

  after(async () => {
    await samplePreload?.remove();
  });

  it('automatically layers PET over CT when opening the ordinary URL list', async () => {
    const params = new URLSearchParams({
      urls: `[${PET_CT_DICOM_DATASETS.map(({ url }) => url).join(',')}]`,
    });
    await volViewPage.open(`?${params}`);
    await volViewPage.waitForViews();
    await selectLayout('Axial Only', 1, false);
    await expect($('[data-testid~="vtk-two-view"]')).toHaveText(
      expect.stringContaining('CT WB')
    );
    await volViewPage.renderingModuleTab.click();
    await expect($$('h4*=PET WB Corrected')).toBeElementsArrayOfSize(1);
    await expect($('[data-testid="layer-range-max"] input')).toBeEnabled();
    await expect($('[data-testid="layer-colormap"]')).toHaveText(
      expect.stringContaining('DICOM Hot Iron')
    );
    await $('header').moveTo();
    await browser.waitUntil(
      async () => (await captureAxialPixels()).colored > 1000,
      { timeoutMsg: 'Expected the URL collection to display PET over CT' }
    );
    expect(await volViewPage.getNotificationsCount()).toBe(0);
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
      if (loading === 0) await expectFullRangeDefault();
      else
        await expect(
          $('[data-testid="layer-range-max"] input')
        ).toHaveAttribute('title', '4000');
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

  it('uses the full PET range by default and restores the middle slice after navigation', async () => {
    const { pixels: initial } = await openAxialPetLayer();
    const view = $('[data-testid~="vtk-two-view"]');
    await expect(view).toHaveText(expect.stringContaining('CT WB'));
    await expect(view).toHaveText(expect.stringContaining('Slice: 6/10'));

    const palette = $('[data-testid="layer-colormap"]');
    await palette.waitForDisplayed();
    await expect(palette).toHaveText(expect.stringContaining('DICOM Hot Iron'));
    await expect(palette).not.toHaveText(
      expect.stringContaining('2hot-opaque')
    );
    await expect($('h4*=PET')).toBeDisplayed();
    await expect($('[data-testid="layer-range-min"] input')).toBeEnabled();
    await expect($('[data-testid="layer-range-max"] input')).toBeEnabled();
    const [minimum, maximum] = await expectFullRangeDefault();
    const opacity = '0.5';
    expect(minimum).toBe('0');
    expect(Number(maximum)).toBeGreaterThan(Number(minimum));
    await expect(
      $('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', opacity);
    await expect($('[data-testid="layer-range-min"] input')).toHaveAttribute(
      'title',
      '0'
    );
    await expect($('[data-testid="layer-range-max"] input')).toHaveAttribute(
      'title',
      maximum
    );
    await expect(
      $('[data-testid="layer-transparent-background"] input')
    ).toBeChecked();
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

    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('retains edited PET colors when replacing the axial view', async () => {
    const initial = await openAxialPetLayer();
    const { pixels: edited, range } = await editPetColors(
      initial.pixels,
      initial.range
    );
    const [minimum, narrowedMaximum] = range;
    await selectLayout('3D Only', 0, true);
    await expect($('[data-testid="layer-range-max"] input')).toBeEnabled();
    await selectLayout('Axial Only', 1, false);
    await expect($('[data-testid="layer-range-min"] input')).toHaveAttribute(
      'title',
      minimum
    );
    await expect($('[data-testid="layer-range-max"] input')).toHaveAttribute(
      'title',
      narrowedMaximum
    );
    await expect($('[data-testid="layer-colormap"]')).toHaveText(
      expect.stringContaining('Cool to Warm')
    );
    await expect(
      $('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.5');
    await $('header').moveTo();
    await browser.waitUntil(
      async () => {
        const pixels = await captureAxialPixels();
        return (
          pixels.blue === edited.blue &&
          pixels.colored === edited.colored &&
          pixels.checksum === edited.checksum
        );
      },
      {
        timeoutMsg:
          'Expected matching PET color counts and intensity sum after replacing the axial view',
      }
    );
    await browser.saveScreenshot(
      path.join(TEMP_DIR, 'pet-ct-sample-edited.png')
    );
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('keeps one PET overlay with edited colors when reopening the sample repeatedly', async () => {
    const started = Date.now();
    const phase = (name: string) =>
      console.info('PET sample %s: %d ms', name, Date.now() - started);
    phase('open start');
    const initial = await openAxialPetLayer();
    phase('open end');
    phase('edit start');
    const { pixels: edited, range } = await editPetColors(
      initial.pixels,
      initial.range
    );
    phase('edit end');
    for (let reopening = 0; reopening < 2; reopening++) {
      phase('reopen ' + (reopening + 1) + ' start');
      await reopenSample(edited, range, 'Cool to Warm');
      phase('reopen ' + (reopening + 1) + ' end');
    }
    phase('final capture start');
    await browser.saveScreenshot(
      path.join(TEMP_DIR, 'pet-ct-sample-reopened.png')
    );
    phase('final capture end');
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('restores default PET colors when reopening the sample after deleting PET', async () => {
    const initial = await openAxialPetLayer();
    await editPetColors(initial.pixels, initial.range);
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
    await reopenSample(initial.pixels, initial.range);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('uses consistent PET DICOM windows and preserves an edited range when saving and reopening', async () => {
    await openPetMetadataVariant('valid');
    await expect($('[data-testid="layer-range-min"] input')).toHaveAttribute(
      'title',
      '0'
    );
    await expect($('[data-testid="layer-range-max"] input')).toHaveAttribute(
      'title',
      '5999'
    );
    await setValueVueInput($('[data-testid="layer-range-min"] input'), '100');
    await setValueVueInput($('[data-testid="layer-range-max"] input'), '3000');
    await expect($('[data-testid="layer-range-max"] input')).toHaveAttribute(
      'title',
      '3000'
    );
    const opacity = () =>
      $('[data-testid="layer-opacity-slider"] [role="slider"]');
    await expect(opacity()).toHaveAttribute('aria-valuenow', '0.5');
    await opacity().execute((element) => element.focus());
    await browser.keys('ArrowLeft');
    await expect(opacity()).toHaveAttribute('aria-valuenow', '0.49');
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await openVolViewPage(saved);
    await volViewPage.renderingModuleTab.click();
    await $('[data-testid="layer-range-max"] input').waitForEnabled();
    expect(await displayedPetRange()).toEqual(['100', '3000']);
    await expect(opacity()).toHaveAttribute('aria-valuenow', '0.49');
  });

  it('falls back to the full overlay range when any PET slice has differing, missing, or invalid window metadata', async () => {
    for (const variant of ['different', 'missing', 'invalid'] as const) {
      await openPetMetadataVariant(variant);
      const initial = await expectFullRangeDefault();
      expect(initial).not.toEqual(['0', '5999']);
    }
  });
});
