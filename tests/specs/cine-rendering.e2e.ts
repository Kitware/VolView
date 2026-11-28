import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import { CINE_US_DATASET, COLOR3D_JPEG_BASELINE_DICOM } from '../datasets';
import type { Utils } from './utils';

const PLAY_CONTROLS = '.play-controls';
const FRAME_LABEL = '.view-annotations .frame-label';
const VIEW_SELECTOR = 'div[data-testid="vtk-view vtk-cine-view"]';

function parseFrameLabel(text: string) {
  const match = text.trim().match(/^Frame:\s*(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  return {
    current: parseInt(match[1], 10),
    total: parseInt(match[2], 10),
  };
}

async function getCineFrameLabelText(page: Page, index = 0) {
  const labels = page.locator(FRAME_LABEL);
  if ((await labels.count()) <= index) return null;
  return (await labels.nth(index).innerText()).trim();
}

async function getCineFrame(page: Page, index = 0) {
  const text = await getCineFrameLabelText(page, index);
  return text ? parseFrameLabel(text) : null;
}

async function waitForCineFrameLabel(page: Page, index = 0) {
  await expect
    .poll(async () => !!(await getCineFrame(page, index)), {
      message: `Expected cine frame label ${index} to appear`,
    })
    .toBe(true);
}

async function waitForCineFrameChange(
  page: Page,
  index: number,
  previousText: string
) {
  await expect
    .poll(
      async () => {
        const text = await getCineFrameLabelText(page, index);
        return !!text && text !== previousText;
      },
      { message: `Expected cine frame counter ${index} to change` }
    )
    .toBe(true);
}

async function openCineDatasetWithConfig(
  volview: VolViewPage,
  utils: Utils,
  config: unknown,
  configName: string
) {
  const configFileName = `${configName}-${Date.now()}.json`;
  await utils.writeManifestToFile(config, configFileName);
  await volview.open(
    `?urls=[tmp/${CINE_US_DATASET.name},tmp/${configFileName}]`
  );
  await volview.waitForViews();
  const notifications = await volview.getNotificationsCount();
  expect(notifications).toEqual(0);
}

async function getActiveCineViewIndex(page: Page) {
  return page.evaluate((selector: string) => {
    const activeBorderColor = 'rgb(60, 179, 113)'; // CSS mediumseagreen
    const views = Array.from(document.querySelectorAll(selector));

    return views.findIndex((view) => {
      const gridItem = view.closest('.grid-item') as HTMLElement | null;
      if (!gridItem) return false;

      const style = getComputedStyle(gridItem);
      return (
        style.borderColor === activeBorderColor ||
        gridItem.style.border.includes('mediumseagreen')
      );
    });
  }, VIEW_SELECTOR);
}

// Steps the page clock between samples, so playback covers the whole window
// however slowly the machine samples.
async function sampleActiveCineViewIndexes(
  page: Page,
  durationMs: number,
  intervalMs = 25
) {
  const samples: number[] = [];

  for (let elapsed = 0; elapsed < durationMs; elapsed += intervalMs) {
    samples.push(await getActiveCineViewIndex(page));
    await page.clock.runFor(intervalMs);
  }

  return samples;
}

async function getFirstCineCanvasStats(page: Page) {
  return page.evaluate((selector: string) => {
    const views = Array.from(document.querySelectorAll(selector)).filter(
      (view) => {
        const rect = view.getBoundingClientRect();
        return rect.width > 10 && rect.height > 10;
      }
    );
    const canvas = views[0]?.querySelector(
      'canvas'
    ) as HTMLCanvasElement | null;
    if (!canvas) return null;

    const context = canvas.getContext('2d');
    if (!context) return null;

    const { width, height } = canvas;
    if (width < 2 || height < 2) return { width, height, nonBlack: 0 };

    const pixels = context.getImageData(0, 0, width, height).data;
    let nonBlack = 0;
    const stride = Math.max(4, Math.floor(pixels.length / 4000 / 4) * 4);

    for (let i = 0; i < pixels.length; i += stride) {
      if (pixels[i] > 5 || pixels[i + 1] > 5 || pixels[i + 2] > 5) {
        nonBlack++;
      }
    }

    return { width, height, nonBlack };
  }, VIEW_SELECTOR);
}

async function waitForFirstCineCanvasToRender(page: Page) {
  await expect
    .poll(
      async () => {
        const stats = await getFirstCineCanvasStats(page);
        return (
          !!stats && stats.width > 10 && stats.height > 10 && stats.nonBlack > 0
        );
      },
      { message: 'Expected cine canvas to stay non-black' }
    )
    .toBe(true);
}

test.describe('VolView cine playback', () => {
  test('shows a frame 0 thumbnail in the patient browser', async ({
    page,
    utils,
  }) => {
    await utils.openUrls([CINE_US_DATASET]);

    const playControls = page.locator(PLAY_CONTROLS).first();
    await expect(playControls).toBeVisible();

    const card = page.locator('.volume-card').first();
    await expect(card).toBeAttached();

    const thumbnail = card.locator('img.v-img__img').first();
    await expect
      .poll(
        async () => {
          if (!(await thumbnail.count())) return false;
          const src = await thumbnail.getAttribute('src');
          return !!src && src.startsWith('data:image/');
        },
        {
          message:
            'Expected cine volume card to render a data-URL thumbnail instead of the modality fallback',
        }
      )
      .toBe(true);
  });

  test('loads a multi-frame ultrasound and scrubs frames', async ({
    page,
    volview,
    utils,
  }) => {
    await utils.openUrls([CINE_US_DATASET]);

    const playControls = page.locator(PLAY_CONTROLS).first();
    await expect(playControls).toBeVisible();

    const frameLabel = page.locator(FRAME_LABEL).first();
    const initialText = (await frameLabel.innerText()).trim();
    // GDCM US-MONO2-8-8x-execho is 8 frames.
    expect(initialText).toBe('Frame: 1 / 8');

    // Scrub one frame forward via arrow key and verify the counter advances.
    // Cine starts at frame 1, so ArrowUp is the direction with headroom.
    await volview.focusFirst2DView();
    await page.keyboard.press('ArrowUp');
    await expect
      .poll(async () => (await frameLabel.innerText()).trim(), {
        message: 'Expected cine frame counter to change after arrow key',
      })
      .not.toBe(initialText);

    // The new label should still be "Frame: N / 8" with N in [1, 8].
    const after = (await frameLabel.innerText()).trim();
    expect(after).toMatch(/^Frame: [1-8] \/ 8$/);
    expect(after).not.toBe(initialText);
  });

  test('advances the frame counter while playing and stops after pause', async ({
    page,
    utils,
  }) => {
    await page.clock.install();
    await utils.openUrls([CINE_US_DATASET]);

    const playButton = page.locator(`${PLAY_CONTROLS} .play-btn`).first();
    await expect(playButton).toBeVisible();
    await waitForCineFrameLabel(page);

    const initialText = (await getCineFrameLabelText(page))!;
    await playButton.click();
    await waitForCineFrameChange(page, 0, initialText);

    const changedText = (await getCineFrameLabelText(page))!;
    expect(changedText).not.toBe(initialText);
    expect(parseFrameLabel(changedText)?.total).toBe(8);

    await playButton.click();
    await expect(
      playButton,
      'Expected play button to enter paused state'
    ).toHaveAttribute('aria-pressed', 'false');

    const pausedText = (await getCineFrameLabelText(page))!;
    await page.clock.runFor(500);
    expect(await getCineFrameLabelText(page)).toBe(pausedText);
  });

  test('keeps the active-view ring stable while two cine views play', async ({
    page,
    volview,
    utils,
  }) => {
    await page.clock.install();
    await openCineDatasetWithConfig(
      volview,
      utils,
      {
        layouts: {
          'Two cine views': [['axial'], ['axial']],
        },
      },
      'two-cine-active-view'
    );
    await volview.waitForViewCounts(2, false);

    const playButtons = page.locator(`${PLAY_CONTROLS} .play-btn`);
    await expect(playButtons).toHaveCount(2);
    await waitForCineFrameLabel(page, 0);
    await waitForCineFrameLabel(page, 1);
    const initialFirstFrame = (await getCineFrameLabelText(page, 0))!;
    const initialSecondFrame = (await getCineFrameLabelText(page, 1))!;

    await playButtons.nth(0).click();
    await playButtons.nth(1).click();
    await waitForCineFrameChange(page, 0, initialFirstFrame);
    await waitForCineFrameChange(page, 1, initialSecondFrame);

    await page.locator(VIEW_SELECTOR).nth(1).locator('canvas').first().click();

    await expect
      .poll(() => getActiveCineViewIndex(page), {
        message: 'Expected second cine view to be active',
      })
      .toBe(1);

    const samples = await sampleActiveCineViewIndexes(page, 1200);
    const unexpectedSamples = samples.filter((index) => index !== 1);
    expect(unexpectedSamples).toEqual([]);
  });

  test('keeps rendering after repeated maximize toggles during playback', async ({
    page,
    utils,
  }) => {
    await page.clock.install();
    await utils.openUrls([COLOR3D_JPEG_BASELINE_DICOM]);

    const playButton = page.locator(`${PLAY_CONTROLS} .play-btn`).first();
    await expect(playButton).toBeVisible();
    await playButton.click();

    await expect(page.locator(VIEW_SELECTOR).first()).toBeVisible();
    await waitForFirstCineCanvasToRender(page);

    for (let i = 0; i < 12; i++) {
      const firstView = page.locator(VIEW_SELECTOR).first();
      await expect(firstView).toBeVisible();
      await firstView.dblclick();
      await page.clock.runFor(50);
      await waitForFirstCineCanvasToRender(page);
    }
  });
});
