import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures';
import { containsText } from '../pageobjects/volview.page';
import type { Utils } from './utils';
import type { SegmentationUtils } from './segmentationTestUtils';

// Vuetify turns off pointer events on a disabled button, so the wrapper it
// sits in is what a hover reaches and what carries the tooltip.
const expectDisabledSaying = async (
  { utils, segmentation }: { utils: Utils; segmentation: SegmentationUtils },
  button: Locator,
  reason: string
) => {
  await expect(button).toBeDisabled();
  const wrapper = button.locator('..');
  await utils.moveToElement(wrapper);
  const tooltip = await segmentation.tooltipOf(wrapper);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(reason);
};

test.describe('Erasing every voxel a segment holds', () => {
  test('leaves the segment nothing to reveal and the image nothing to save', async ({
    page,
    volview,
    utils,
    annotation,
    segmentation,
  }) => {
    const { centerX: x, centerY: y } = await annotation.setupTest();
    await volview.activatePaint();
    await segmentation.openAnnotationSegments();

    // A press is a stroke of one sample. The eraser presses the same brush at
    // the same point, so it takes every voxel the paint stroke wrote.
    await annotation.nudgeTo(x, y);
    await annotation.pressAtPointer();
    await segmentation.waitForSegmentContent('Segment 1');
    const save = page.locator('[data-testid="save-segments-button"]');
    await expect(save).toBeEnabled();

    await page
      .locator('button.mode-button', { hasText: containsText('Erase') })
      .click();
    await expect(page.locator('button.mode-button.selected')).toHaveText(
      'Erase'
    );
    await annotation.nudgeTo(x, y);
    await annotation.pressAtPointer();

    const row = await segmentation.segmentRow('Segment 1');
    await expectDisabledSaying(
      { utils, segmentation },
      row.locator('[data-testid="reveal-segment-button"]'),
      'This segment has nothing on this image'
    );
    await expectDisabledSaying(
      { utils, segmentation },
      save,
      'Nothing is painted on this image yet'
    );
  });
});
