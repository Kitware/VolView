import { Key } from 'webdriverio';
import { volViewPage } from '../pageobjects/volview.page';
import { CINE_US_DATASET } from './configTestUtils';
import { openUrls } from './utils';

const PLAY_CONTROLS = '.play-controls';
const FRAME_LABEL = '.view-annotations .frame-label';

describe('VolView cine playback', () => {
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
});
