import { Key } from 'webdriverio';
import { volViewPage } from '../pageobjects/volview.page';
import {
  CINE_US_DATASET,
  COLOR3D_JPEG_BASELINE_DICOM,
} from './configTestUtils';
import { downloadFile, openUrls, writeManifestToFile } from './utils';

const PLAY_CONTROLS = '.play-controls';
const FRAME_LABEL = '.view-annotations .frame-label';
const VIEW_SELECTOR = 'div[data-testid="vtk-view vtk-two-view"]';

function parseFrameLabel(text: string) {
  const match = text.trim().match(/^Frame:\s*(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  return {
    current: parseInt(match[1], 10),
    total: parseInt(match[2], 10),
  };
}

async function getCineFrameLabelText(index = 0) {
  const labels = await $$(FRAME_LABEL);
  if ((await labels.length) <= index) return null;
  return (await labels[index].getText()).trim();
}

async function getCineFrame(index = 0) {
  const text = await getCineFrameLabelText(index);
  return text ? parseFrameLabel(text) : null;
}

async function waitForCineFrameLabel(index = 0) {
  await browser.waitUntil(
    async () => {
      const frame = await getCineFrame(index);
      return !!frame;
    },
    {
      timeout: 10000,
      timeoutMsg: `Expected cine frame label ${index} to appear`,
    }
  );
}

async function waitForCineFrameChange(index: number, previousText: string) {
  await browser.waitUntil(
    async () => {
      const text = await getCineFrameLabelText(index);
      return !!text && text !== previousText;
    },
    {
      timeout: 5000,
      timeoutMsg: `Expected cine frame counter ${index} to change`,
    }
  );
}

async function openCineDatasetWithConfig(config: unknown, configName: string) {
  await downloadFile(CINE_US_DATASET.url, CINE_US_DATASET.name);
  const configFileName = `${configName}-${Date.now()}.json`;
  await writeManifestToFile(config, configFileName);
  await volViewPage.open(
    `?config=[tmp/${configFileName}]&urls=[tmp/${CINE_US_DATASET.name}]`
  );
  await volViewPage.waitForViews();
  const notifications = await volViewPage.getNotificationsCount();
  expect(notifications).toEqual(0);
}

async function getActiveCineViewIndex() {
  return browser.execute((selector: string) => {
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

async function sampleActiveCineViewIndexes(
  durationMs: number,
  intervalMs = 25
) {
  const samples: number[] = [];
  const deadline = Date.now() + durationMs;

  while (Date.now() < deadline) {
    samples.push(await getActiveCineViewIndex());
    await browser.pause(intervalMs);
  }

  return samples;
}

async function getFirstCineCanvasStats() {
  return browser.execute((selector: string) => {
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

async function waitForFirstCineCanvasToRender(timeout = 5000) {
  await browser.waitUntil(
    async () => {
      const stats = await getFirstCineCanvasStats();
      return (
        !!stats && stats.width > 10 && stats.height > 10 && stats.nonBlack > 0
      );
    },
    {
      timeout,
      interval: 50,
      timeoutMsg: 'Expected cine canvas to stay non-black',
    }
  );
}

describe('VolView cine playback', () => {
  it('shows a frame 0 thumbnail in the patient browser', async () => {
    await openUrls([CINE_US_DATASET]);

    const playControls = $(PLAY_CONTROLS);
    await playControls.waitForDisplayed({ timeout: 10000 });

    const card = $('.volume-card');
    await card.waitForExist({ timeout: 10000 });

    const thumbnail = card.$('img.v-img__img');
    await browser.waitUntil(
      async () => {
        if (!(await thumbnail.isExisting())) return false;
        const src = await thumbnail.getAttribute('src');
        return !!src && src.startsWith('data:image/');
      },
      {
        timeout: 10000,
        timeoutMsg:
          'Expected cine volume card to render a data-URL thumbnail instead of the modality fallback',
      }
    );
  });

  it('loads a multi-frame ultrasound and scrubs frames', async () => {
    await openUrls([CINE_US_DATASET]);

    const playControls = $(PLAY_CONTROLS);
    await playControls.waitForDisplayed({ timeout: 10000 });

    const frameLabel = await $(FRAME_LABEL);
    const initialText = (await frameLabel.getText()).trim();
    // GDCM US-MONO2-8-8x-execho is 8 frames.
    expect(initialText).toBe('Frame: 1 / 8');

    // Scrub one frame forward via arrow key and verify the counter advances.
    // Cine starts at frame 1, so ArrowUp is the direction with headroom.
    await volViewPage.focusFirst2DView();
    await browser.keys([Key.ArrowUp]);
    await browser.waitUntil(
      async () => (await frameLabel.getText()).trim() !== initialText,
      {
        timeout: 5000,
        timeoutMsg: 'Expected cine frame counter to change after arrow key',
      }
    );

    // The new label should still be "Frame: N / 8" with N in [1, 8].
    const after = (await frameLabel.getText()).trim();
    expect(after).toMatch(/^Frame: [1-8] \/ 8$/);
    expect(after).not.toBe(initialText);
  });

  it('advances the frame counter while playing and stops after pause', async () => {
    await openUrls([CINE_US_DATASET]);

    const playButton = $(`${PLAY_CONTROLS} .play-btn`);
    await playButton.waitForDisplayed({ timeout: 10000 });
    await waitForCineFrameLabel();

    const initialText = (await getCineFrameLabelText())!;
    await playButton.click();
    await waitForCineFrameChange(0, initialText);

    const changedText = (await getCineFrameLabelText())!;
    expect(changedText).not.toBe(initialText);
    expect(parseFrameLabel(changedText)?.total).toBe(8);

    await playButton.click();
    await browser.waitUntil(
      async () => (await playButton.getAttribute('aria-pressed')) === 'false',
      {
        timeout: 1000,
        timeoutMsg: 'Expected play button to enter paused state',
      }
    );

    const pausedText = (await getCineFrameLabelText())!;
    await browser.pause(500);
    expect(await getCineFrameLabelText()).toBe(pausedText);
  });

  it('keeps the active-view ring stable while two cine views play', async () => {
    await openCineDatasetWithConfig(
      {
        layouts: {
          'Two cine views': [['axial'], ['axial']],
        },
      },
      'two-cine-active-view'
    );
    await volViewPage.waitForViewCounts(2, false);

    const playButtons = await $$(`${PLAY_CONTROLS} .play-btn`);
    expect(await playButtons.length).toBe(2);
    await waitForCineFrameLabel(0);
    await waitForCineFrameLabel(1);
    const initialFirstFrame = (await getCineFrameLabelText(0))!;
    const initialSecondFrame = (await getCineFrameLabelText(1))!;

    await playButtons[0].click();
    await playButtons[1].click();
    await waitForCineFrameChange(0, initialFirstFrame);
    await waitForCineFrameChange(1, initialSecondFrame);

    const views = await $$(VIEW_SELECTOR);
    const secondCanvas = await views[1].$('canvas');
    await secondCanvas.click();

    await browser.waitUntil(
      async () => (await getActiveCineViewIndex()) === 1,
      {
        timeout: 2000,
        timeoutMsg: 'Expected second cine view to be active',
      }
    );

    const samples = await sampleActiveCineViewIndexes(1200);
    const unexpectedSamples = samples.filter((index) => index !== 1);
    expect(unexpectedSamples).toEqual([]);
  });

  it('keeps rendering after repeated maximize toggles during playback', async () => {
    await openUrls([COLOR3D_JPEG_BASELINE_DICOM]);

    const playButton = $(`${PLAY_CONTROLS} .play-btn`);
    await playButton.waitForDisplayed({ timeout: 10000 });
    await playButton.click();

    await $(VIEW_SELECTOR).waitForDisplayed({
      timeout: 10000,
    });
    await waitForFirstCineCanvasToRender();

    for (let i = 0; i < 12; i++) {
      const firstView = $(VIEW_SELECTOR);
      await firstView.waitForDisplayed({ timeout: 5000 });
      await firstView.doubleClick();
      await browser.pause(50);
      await waitForFirstCineCanvasToRender(1500);
    }
  });
});
