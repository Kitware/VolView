import * as path from 'path';
import { readFileSync, writeFileSync } from 'node:fs';
import dcmjs from 'dcmjs';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { PET_CT_DICOM_DATASETS } from '../datasets';
import {
  containsText,
  exactText,
  setValueVueInput,
  type VolViewPage,
} from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import type { Utils } from './utils';

// Init scripts cannot be removed; the latest wraps the earlier ones, so its
// mapping wins.
async function useLocalSampleFiles(
  page: Page,
  files: { url: string; name: string }[]
) {
  await page.addInitScript((datasets) => {
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

/** Rewrites the windows through a full read and write; null removes the tag. */
function withWindow(file: Buffer, window: Record<string, string | null>) {
  const message = dcmjs.data.DicomMessage.readFile(
    Uint8Array.from(file).buffer
  );
  Object.entries(window).forEach(([tag, value]) => {
    if (value === null) delete message.dict[tag];
    else message.dict[tag]!.Value = [value];
  });
  return Buffer.from(message.write());
}

type PetCtFixtures = {
  page: Page;
  volview: VolViewPage;
  utils: Utils;
  scratch: Scratch;
};

const createPetCtSteps = ({ page, volview, utils, scratch }: PetCtFixtures) => {
  const captureAxialPixels = async () =>
    (await utils.capture2DViewScreenshotMetrics('pet-ct-capture.png'))[0];

  const clickSample = async () => {
    const sample = volview.samplesList.locator('[title="PET/CT Chest"]');
    await expect(sample).toBeAttached();
    await sample.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await sample.click();
  };

  const openAxialSample = async () => {
    await volview.open();
    await utils.selectLayout('Axial Only', 1, false);
    await clickSample();
    await volview.waitForViews();
  };

  const displayedPetRange = async () => {
    return Promise.all(
      ['min', 'max'].map(
        async (endpoint) =>
          (await page
            .locator(`[data-testid="layer-range-${endpoint}"] input`)
            .getAttribute('title'))!
      )
    );
  };

  const expectPetRange = async ([minimum, maximum]: string[]) => {
    await expect(
      page.locator('[data-testid="layer-range-min"] input')
    ).toHaveAttribute('title', minimum);
    await expect(
      page.locator('[data-testid="layer-range-max"] input')
    ).toHaveAttribute('title', maximum);
  };

  const expectFullRangeDefault = async () => {
    const initial = await displayedPetRange();
    const contrast = page.locator('[data-testid="layer-contrast"]');
    await contrast.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await contrast.click();
    const full = page.locator('[data-testid="layer-contrast-FullRange"]');
    await full.click();
    await expect(
      page.locator('[data-testid="layer-contrast-menu"]')
    ).toBeHidden();
    expect(await displayedPetRange()).toEqual(initial);
    return initial;
  };

  const openAxialPetLayer = async () => {
    await openAxialSample();
    await volview.waitForViewCounts(1, false);
    await volview.renderingModuleTab.click();
    await expect(
      page.locator('[data-testid="layer-range-max"] input')
    ).toBeEnabled();
    await utils.waitForModuleTransitions();
    await utils.moveToElement(page.locator('header'));
    await expect
      .poll(async () => (await captureAxialPixels()).colored > 1000, {
        message: 'Expected the sample to display PET over CT',
      })
      .toBe(true);
    return {
      pixels: await captureAxialPixels(),
      range: await displayedPetRange(),
    };
  };

  const editPetColors = async (
    initial: Awaited<ReturnType<typeof captureAxialPixels>>,
    [minimum, maximum]: string[]
  ) => {
    const palette = page.locator('[data-testid="layer-colormap"]');
    await palette.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await palette.click();
    await expect(
      page.locator('[role="option"]', {
        hasText: exactText('DICOM Hot Iron'),
      })
    ).toBeAttached();
    await expect(
      page.locator('[role="option"]', { hasText: exactText('Heat') })
    ).not.toBeAttached();
    await expect(
      page.locator('[role="option"]', { hasText: exactText('2hot-opaque') })
    ).not.toBeAttached();
    const coolToWarm = page.locator('[role="option"]', {
      hasText: containsText('Cool to Warm'),
    });
    await coolToWarm.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await coolToWarm.click();
    await utils.moveToElement(page.locator('header'));
    await expect
      .poll(
        async () => {
          const pixels = await captureAxialPixels();
          return pixels.colored > 1000 && pixels.checksum !== initial.checksum;
        },
        {
          message:
            'Expected the selected palette to change the visible PET colors',
        }
      )
      .toBe(true);
    const beforeRange = await captureAxialPixels();
    const narrowedMaximum = String((Number(minimum) + Number(maximum)) / 2);
    await setValueVueInput(
      page.locator('[data-testid="layer-range-max"] input'),
      narrowedMaximum
    );
    await utils.moveToElement(page.locator('header'));
    await expectPetRange([minimum, narrowedMaximum]);
    await expect
      .poll(
        async () => {
          const pixels = await captureAxialPixels();
          return (
            pixels.colored > 1000 && pixels.checksum !== beforeRange.checksum
          );
        },
        {
          message:
            'Expected narrowing the PET range to change the visible colored regions',
        }
      )
      .toBe(true);
    return {
      pixels: await captureAxialPixels(),
      range: [minimum, narrowedMaximum],
    };
  };

  const showSampleData = async () => {
    await page.locator('[data-testid="module-tab-Data"]').click();
    await utils.waitForModuleTransitions();
    const samplesSection = page.locator('.v-expansion-panel-title', {
      hasText: containsText('Sample Data'),
    });
    if ((await samplesSection.getAttribute('aria-expanded')) !== 'true') {
      await samplesSection.click();
      await expect(samplesSection).toHaveAttribute('aria-expanded', 'true');
      await utils.waitForModuleTransitions();
    }
  };

  const reopenSample = async (
    expected: Awaited<ReturnType<typeof captureAxialPixels>>,
    range: string[],
    preset = 'DICOM Hot Iron'
  ) => {
    await showSampleData();
    await page.screenshot({ path: scratch.path('pet-ct-sample-reload.png') });
    await clickSample();
    await expect(
      page.locator('.volume-card[html-title="PET WB Corrected"]')
    ).toBeVisible();
    await utils.waitForModuleTransitions();
    await volview.waitForViewCounts(1, false);
    await volview.renderingModuleTab.click();
    await expect(
      page.locator('h4', { hasText: containsText('PET WB Corrected') })
    ).toHaveCount(1);
    for (const control of [
      'layer-colormap',
      'layer-transparent-background',
      'layer-range-min',
      'layer-range-max',
      'layer-opacity-slider',
    ])
      await expect(page.locator(`[data-testid="${control}"]`)).toHaveCount(1);
    await expectPetRange(range);
    await expect(page.locator('[data-testid="layer-colormap"]')).toContainText(
      preset
    );
    await expect(
      page.locator('[data-testid="layer-transparent-background"] input')
    ).toBeChecked();
    await expect(
      page.locator('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.5');
    await utils.moveToElement(page.locator('header'));
    await expect
      .poll(
        async () => {
          const pixels = await captureAxialPixels();
          return (
            pixels.colored === expected.colored &&
            pixels.blue === expected.blue &&
            pixels.checksum === expected.checksum
          );
        },
        {
          message:
            'Expected reopening the sample to restore exactly one PET overlay with its expected appearance',
        }
      )
      .toBe(true);
  };

  const openPetMetadataVariant = async (
    variant: 'valid' | 'different' | 'missing' | 'invalid'
  ) => {
    const directory = utils.makeTempDir(`pet-window-${variant}`);
    const petFiles = PET_CT_DICOM_DATASETS.filter(({ name }) =>
      name.startsWith('PET-CT-PT-')
    );
    const lastWidth = {
      valid: '6000',
      different: '7000',
      invalid: '0',
      missing: null,
    };
    for (const [index, { name }] of petFiles.entries()) {
      const bytes = withWindow(readFileSync(scratch.path(name)), {
        '00281050': '3000',
        '00281051': index === petFiles.length - 1 ? lastWidth[variant] : '6000',
      });
      writeFileSync(path.join(directory, name), bytes);
    }
    await useLocalSampleFiles(
      page,
      PET_CT_DICOM_DATASETS.map((file) => ({
        url: file.url,
        name: file.name.startsWith('PET-CT-PT-')
          ? `pet-window-${variant}/${file.name}`
          : file.name,
      }))
    );
    await openAxialSample();
    await volview.renderingModuleTab.click();
    await expect(
      page.locator('[data-testid="layer-range-max"] input')
    ).toBeEnabled();
    await utils.waitForModuleTransitions();
  };

  const openEditedPetLayer = async () => {
    const initial = await openAxialPetLayer();
    return editPetColors(initial.pixels, initial.range);
  };

  return {
    captureAxialPixels,
    clickSample,
    openAxialSample,
    displayedPetRange,
    expectPetRange,
    expectFullRangeDefault,
    openAxialPetLayer,
    editPetColors,
    openEditedPetLayer,
    showSampleData,
    reopenSample,
    openPetMetadataVariant,
  };
};

test.describe('PET/CT sample', () => {
  test.beforeEach(({ page }) =>
    useLocalSampleFiles(page, PET_CT_DICOM_DATASETS)
  );

  test('automatically layers PET over CT when opening the ordinary URL list', async ({
    page,
    volview,
    utils,
    scratch,
  }) => {
    const pet = createPetCtSteps({ page, volview, utils, scratch });
    const params = new URLSearchParams({
      urls: `[${PET_CT_DICOM_DATASETS.map(({ url }) => url).join(',')}]`,
    });
    await volview.open(`?${params}`);
    await volview.waitForViews();
    await utils.selectLayout('Axial Only', 1, false);
    await expect(
      page.locator('[data-testid~="vtk-two-view"]').first()
    ).toContainText('CT WB');
    await volview.renderingModuleTab.click();
    await expect(
      page.locator('h4', { hasText: containsText('PET WB Corrected') })
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid="layer-range-max"] input')
    ).toBeEnabled();
    await expect(page.locator('[data-testid="layer-colormap"]')).toContainText(
      'DICOM Hot Iron'
    );
    await utils.moveToElement(page.locator('header'));
    await expect
      .poll(async () => (await pet.captureAxialPixels()).colored > 1000, {
        message: 'Expected the URL collection to display PET over CT',
      })
      .toBe(true);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('preserves Four Up when loading and reopening the sample', async ({
    page,
    volview,
    utils,
    scratch,
  }) => {
    const pet = createPetCtSteps({ page, volview, utils, scratch });
    const ctFile = PET_CT_DICOM_DATASETS.find(({ name }) =>
      name.startsWith('PET-CT-CT-')
    )!;
    const { dict } = dcmjs.data.DicomMessage.readFile(
      Uint8Array.from(readFileSync(scratch.path(ctFile.name))).buffer
    );
    const firstValue = (tag: string) => Number(dict[tag]!.Value[0]);
    const width = firstValue('00281051');
    const level = firstValue('00281050');
    expect(width).toBeGreaterThan(0);
    expect(Number.isFinite(level)).toBe(true);
    await volview.open();
    await utils.selectLayout('Four Up', 3, true);
    for (let loading = 0; loading < 2; loading++) {
      await pet.showSampleData();
      await pet.clickSample();
      await expect(
        page.locator('[data-testid~="vtk-two-view"]').first()
      ).toContainText('CT WB');
      await volview.renderingModuleTab.click();
      await expect(
        page
          .locator('h4', { hasText: containsText('PET WB Corrected') })
          .first()
      ).toBeVisible();
      if (loading === 0) await pet.expectFullRangeDefault();
      else
        await expect(
          page.locator('[data-testid="layer-range-max"] input')
        ).toHaveAttribute('title', '4000');
      await volview.waitForViewCounts(3, true);
      const slices = page.locator('[data-testid~="vtk-two-view"]');
      for (const view of await slices.all()) {
        await expect(view).toContainText('CT WB');
        await expect(view).toContainText(
          `W/L: ${width.toFixed(2)} / ${level.toFixed(2)}`
        );
      }
      await volview.layoutButton.click();
      await expect(
        page.locator('.v-list-item--active .v-list-item-title')
      ).toHaveText('Four Up');
      await page.keyboard.press('Escape');
      await utils.waitForModuleTransitions();
      if (loading === 0) {
        const maximum = page.locator('[data-testid="layer-range-max"] input');
        await maximum.evaluate((element) =>
          element.scrollIntoView({ block: 'center', behavior: 'instant' })
        );
        await setValueVueInput(maximum, '4000');
        await expect(maximum).toHaveAttribute('title', '4000');
      }
    }
  });

  test('uses the full PET range by default and restores the middle slice after navigation', async ({
    page,
    volview,
    utils,
    scratch,
  }) => {
    const pet = createPetCtSteps({ page, volview, utils, scratch });
    const { pixels: initial } = await pet.openAxialPetLayer();
    const view = page.locator('[data-testid~="vtk-two-view"]').first();
    await expect(view).toContainText('CT WB');
    await expect(view).toContainText('Slice: 6/10');

    const palette = page.locator('[data-testid="layer-colormap"]');
    await expect(palette).toBeVisible();
    await expect(palette).toContainText('DICOM Hot Iron');
    await expect(palette).not.toContainText('2hot-opaque');
    await expect(
      page.locator('h4', { hasText: containsText('PET') }).first()
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="layer-range-min"] input')
    ).toBeEnabled();
    await expect(
      page.locator('[data-testid="layer-range-max"] input')
    ).toBeEnabled();
    const [minimum, maximum] = await pet.expectFullRangeDefault();
    const opacity = '0.5';
    expect(minimum).toBe('0');
    expect(Number(maximum)).toBeGreaterThan(Number(minimum));
    await expect(
      page.locator('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', opacity);
    await pet.expectPetRange(['0', maximum]);
    await expect(
      page.locator('[data-testid="layer-transparent-background"] input')
    ).toBeChecked();
    await page.screenshot({ path: scratch.path('pet-ct-sample.png') });
    await view.locator('canvas').click();
    await page.keyboard.press('ArrowDown');
    await expect(view).toContainText('Slice: 5/10');
    await expect
      .poll(
        async () =>
          (await pet.captureAxialPixels()).checksum !== initial.checksum,
        {
          message:
            'Expected moving to an adjacent slice to change the displayed image',
        }
      )
      .toBe(true);
    await page.keyboard.press('ArrowUp');
    await expect(view).toContainText('Slice: 6/10');
    await expect
      .poll(
        async () =>
          (await pet.captureAxialPixels()).checksum === initial.checksum,
        {
          message:
            'Expected returning to the middle slice to restore its image',
        }
      )
      .toBe(true);

    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('retains edited PET colors when replacing the axial view', async ({
    page,
    volview,
    utils,
    scratch,
  }) => {
    const pet = createPetCtSteps({ page, volview, utils, scratch });
    const { pixels: edited, range } = await pet.openEditedPetLayer();
    await utils.selectLayout('3D Only', 0, true);
    await expect(
      page.locator('[data-testid="layer-range-max"] input')
    ).toBeEnabled();
    await utils.selectLayout('Axial Only', 1, false);
    await pet.expectPetRange(range);
    await expect(page.locator('[data-testid="layer-colormap"]')).toContainText(
      'Cool to Warm'
    );
    await expect(
      page.locator('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.5');
    await utils.moveToElement(page.locator('header'));
    await expect
      .poll(
        async () => {
          const pixels = await pet.captureAxialPixels();
          return (
            pixels.blue === edited.blue &&
            pixels.colored === edited.colored &&
            pixels.checksum === edited.checksum
          );
        },
        {
          message:
            'Expected matching PET color counts and intensity sum after replacing the axial view',
        }
      )
      .toBe(true);
    await page.screenshot({ path: scratch.path('pet-ct-sample-edited.png') });
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('keeps one PET overlay with edited colors when reopening the sample repeatedly', async ({
    page,
    volview,
    utils,
    scratch,
  }) => {
    const pet = createPetCtSteps({ page, volview, utils, scratch });
    const { pixels: edited, range } = await pet.openEditedPetLayer();
    for (let reopening = 0; reopening < 2; reopening++) {
      await pet.reopenSample(edited, range, 'Cool to Warm');
    }
    await page.screenshot({ path: scratch.path('pet-ct-sample-reopened.png') });
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('restores default PET colors when reopening the sample after deleting PET', async ({
    page,
    volview,
    utils,
    scratch,
  }) => {
    const pet = createPetCtSteps({ page, volview, utils, scratch });
    const initial = await pet.openAxialPetLayer();
    await pet.editPetColors(initial.pixels, initial.range);
    await page.locator('[data-testid="module-tab-Data"]').click();
    const petCard = page.locator('.volume-card[html-title="PET WB Corrected"]');
    await expect(petCard).toBeVisible();
    await utils.waitForModuleTransitions();
    const petMenu = petCard.locator('[data-testid="dataset-menu-button"]');
    await petMenu.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await petMenu.click();
    const deleteItem = page.locator('.v-list-item', {
      hasText: exactText('Delete'),
    });
    await deleteItem.click();
    await expect(petCard).not.toBeAttached();
    await expect(
      page.locator('.volume-card[html-title="CT WB  1.0  B30f"]')
    ).toBeAttached();
    await pet.reopenSample(initial.pixels, initial.range);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('uses consistent PET DICOM windows and preserves an edited range when saving and reopening', async ({
    page,
    volview,
    utils,
    scratch,
  }) => {
    const pet = createPetCtSteps({ page, volview, utils, scratch });
    await pet.openPetMetadataVariant('valid');
    await pet.expectPetRange(['0', '5999']);
    await setValueVueInput(
      page.locator('[data-testid="layer-range-min"] input'),
      '100'
    );
    await setValueVueInput(
      page.locator('[data-testid="layer-range-max"] input'),
      '3000'
    );
    await expect(
      page.locator('[data-testid="layer-range-max"] input')
    ).toHaveAttribute('title', '3000');
    const opacity = () =>
      page.locator('[data-testid="layer-opacity-slider"] [role="slider"]');
    await expect(opacity()).toHaveAttribute('aria-valuenow', '0.5');
    await opacity().focus();
    await page.keyboard.press('ArrowLeft');
    await expect(opacity()).toHaveAttribute('aria-valuenow', '0.49');
    const saved = await volview.saveSession();
    await utils.openVolViewPage(saved);
    await volview.renderingModuleTab.click();
    await expect(
      page.locator('[data-testid="layer-range-max"] input')
    ).toBeEnabled();
    expect(await pet.displayedPetRange()).toEqual(['100', '3000']);
    await expect(opacity()).toHaveAttribute('aria-valuenow', '0.49');
  });

  test('falls back to the full overlay range when any PET slice has differing, missing, or invalid window metadata', async ({
    page,
    volview,
    utils,
    scratch,
  }) => {
    const pet = createPetCtSteps({ page, volview, utils, scratch });
    for (const variant of ['different', 'missing', 'invalid'] as const) {
      await pet.openPetMetadataVariant(variant);
      const initial = await pet.expectFullRangeDefault();
      expect(initial).not.toEqual(['0', '5999']);
    }
  });
});
