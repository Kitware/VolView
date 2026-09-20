import type { ChainablePromiseElement } from 'webdriverio';
import { volViewPage } from '../pageobjects/volview.page';
import { nudgeTo, pressAtPointer, setupTest } from './annotationTestUtils';
import {
  openAnnotationSegments,
  segmentRow,
  tooltipOf,
  waitForSegmentContent,
} from './segmentationTestUtils';

// Vuetify turns off pointer events on a disabled button, so the wrapper it
// sits in is what a hover reaches and what carries the tooltip.
const expectDisabledSaying = async (
  button: ChainablePromiseElement,
  reason: string
) => {
  await expect(button).toBeDisabled();
  const wrapper = button.$('..');
  await wrapper.moveTo();
  const tooltip = await tooltipOf(wrapper);
  await expect(tooltip).toBeDisplayed();
  await expect(tooltip).toHaveText(reason);
};

describe('Erasing every voxel a segment holds', () => {
  it('leaves the segment nothing to reveal and the image nothing to save', async () => {
    const { centerX: x, centerY: y } = await setupTest();
    await volViewPage.activatePaint();
    await openAnnotationSegments();

    // A press is a stroke of one sample. The eraser presses the same brush at
    // the same point, so it takes every voxel the paint stroke wrote.
    await nudgeTo(x, y);
    await pressAtPointer();
    await waitForSegmentContent('Segment 1');
    const save = $('[data-testid="save-segments-button"]');
    await expect(save).toBeEnabled();

    const erase = $('button.mode-button*=Erase');
    await erase.waitForClickable();
    await erase.click();
    await expect($('button.mode-button.selected')).toHaveText('Erase');
    await nudgeTo(x, y);
    await pressAtPointer();

    const row = await segmentRow('Segment 1');
    await expectDisabledSaying(
      row.$('[data-testid="reveal-segment-button"]'),
      'This segment has nothing on this image'
    );
    await expectDisabledSaying(save, 'Nothing is painted on this image yet');
  });
});
