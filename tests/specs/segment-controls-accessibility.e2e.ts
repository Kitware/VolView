import { test, expect } from '../fixtures';
import { CONTENT_VIEWPORT } from '../e2eRun';
import { containsText, setValueVueInput } from '../pageobjects/volview.page';
import { ONE_CT_SLICE_DICOM } from '../datasets';

test.describe('Segment control accessibility', () => {
  test.beforeEach(async ({ utils }) => {
    await utils.openUrls([ONE_CT_SLICE_DICOM]);
  });

  test('names each interactive paint parameter', async ({ page, volview }) => {
    // Picking up the brush opens its controls without a click on the panel.
    await volview.activatePaint();

    const brush = page.locator('[role="slider"][aria-label="Brush size"]');
    await expect(brush).toBeVisible();
    const initialSize = await brush.getAttribute('aria-valuenow');
    await brush.focus();
    await page.keyboard.press('ArrowRight');
    expect(await brush.getAttribute('aria-valuenow')).not.toBe(initialSize);

    const minimum = page.locator('input[aria-label="Minimum threshold"]');
    const maximum = page.locator('input[aria-label="Maximum threshold"]');
    await expect(minimum).toBeVisible();
    await expect(maximum).toBeVisible();
    await expect(
      page.locator('[role="slider"][aria-label="Minimum threshold"]')
    ).toBeVisible();
    await expect(
      page.locator('[role="slider"][aria-label="Maximum threshold"]')
    ).toBeVisible();
    const sync = page.locator('input[aria-label="Sync Views"]');
    await expect(sync).toBeAttached();
    await expect(sync).toHaveRole('checkbox');
    const initiallySelected = await sync.isChecked();
    await sync.focus();
    await page.keyboard.press('Space');
    expect(await sync.isChecked()).toBe(!initiallySelected);

    // Each switch toggles from its label too.
    await page
      .locator('label', { hasText: containsText('Sync Views') })
      .click();
    expect(await sync.isChecked()).toBe(initiallySelected);
    const overlap = page.locator('input[aria-label="Allow Overlap"]');
    await page
      .locator('label', { hasText: containsText('Allow Overlap') })
      .click();
    await expect(overlap).toBeChecked();
  });

  test('disables the brush controls, saying why, until the Paint tool is picked', async ({
    page,
    volview,
    segmentation,
  }) => {
    await segmentation.openAnnotationSegments();
    await page
      .locator('button.v-expansion-panel-title', {
        hasText: containsText('Paint'),
      })
      .click();
    const erase = page.locator('button.mode-button', {
      hasText: containsText('Erase'),
    });
    const sync = page.locator('input[aria-label="Sync Views"]');
    const overlap = page.locator('input[aria-label="Allow Overlap"]');
    await expect(erase).toBeDisabled();
    await expect(sync).toBeDisabled();
    await expect(overlap).toBeDisabled();

    // Reached by keyboard from the panel title, so no pointer position is
    // involved: the disabled modes first, then the brush parameters.
    await page.keyboard.press('Tab');
    const modes = page.locator(':focus');
    const modesReason = await segmentation.tooltipOf(modes);
    await expect(modesReason).toBeVisible();
    await expect(modesReason).toHaveText(
      'Select the Paint tool to paint, erase or pick a segment'
    );
    await page.keyboard.press('Tab');
    const parameters = page.locator('[data-testid="paint-parameters"]');
    await expect(parameters).toBeFocused();
    const reason = await segmentation.tooltipOf(parameters);
    await expect(reason).toBeVisible();
    await expect(reason).toHaveText(
      'Select the Paint tool to adjust the brush'
    );
    await page.keyboard.press('Tab');
    const overlapControls = page.locator('.paint-switches > div:first-child');
    await expect(overlapControls).toBeFocused();
    const overlapReason = await segmentation.tooltipOf(overlapControls);
    await expect(overlapReason).toBeVisible();
    await expect(overlapReason).toHaveText(
      'Select the Paint tool to adjust the brush'
    );

    await volview.activatePaint();
    await expect(erase).toBeEnabled();
    await expect(sync).toBeEnabled();
    await expect(overlap).toBeEnabled();
    await volview.activateRectangle();
    await expect(overlap).toBeDisabled();
  });

  test('keeps the segment editor usable at 375px and side by side on desktop', async ({
    page,
    volview,
    segmentation,
  }) => {
    await volview.activatePaint();
    const view = page.locator('div[data-testid~="vtk-two-view"]').first();
    await volview.paintStrokeOnView(view);
    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
    const row = await segmentation.segmentRow('Segment 1');
    const originalColor = await segmentation.segmentColor('Segment 1');
    await row.locator('[data-testid="edit-segment-button"]').click();

    const dialog = page.locator('div[role="dialog"]').first();
    await expect(dialog).toBeVisible();
    const layout = dialog.locator('.segment-editor-layout');
    const fields = dialog.locator('.segment-editor-fields');
    const picker = dialog.locator('.segment-editor-color-picker');
    const desktopLayout = await fields.evaluate(
      (fieldsElement: HTMLElement, pickerElement) => {
        return {
          fieldsLeft: fieldsElement.offsetLeft,
          fieldsWidth: fieldsElement.clientWidth,
          pickerLeft: (pickerElement as HTMLElement).offsetLeft,
        };
      },
      await picker.elementHandle()
    );
    expect(desktopLayout.pickerLeft).toBeGreaterThanOrEqual(
      desktopLayout.fieldsLeft + desktopLayout.fieldsWidth
    );

    await page.setViewportSize({
      width: 640,
      height: CONTENT_VIEWPORT.height,
    });
    await page.setViewportSize({
      width: 375,
      height: CONTENT_VIEWPORT.height,
    });
    expect(await page.evaluate(() => window.innerWidth)).toBe(375);
    const narrowLayout = await layout.evaluate(
      (layoutElement, { fieldsElement, pickerElement }) => {
        return {
          fieldsHeight: (fieldsElement as HTMLElement).clientHeight,
          pickerOffsetTop: (pickerElement as HTMLElement).offsetTop,
          pickerWidth: (pickerElement as HTMLElement).clientWidth,
          layoutWidth: layoutElement.clientWidth,
        };
      },
      {
        fieldsElement: await fields.elementHandle(),
        pickerElement: await picker.elementHandle(),
      }
    );
    expect(narrowLayout.pickerWidth).toBeGreaterThan(250);
    expect(narrowLayout.pickerOffsetTop).toBeGreaterThanOrEqual(
      narrowLayout.fieldsHeight
    );
    expect(narrowLayout.pickerWidth).toBeLessThanOrEqual(
      narrowLayout.layoutWidth
    );
    await setValueVueInput(
      dialog.locator('.v-color-picker-edit input').first(),
      '0'
    );
    const nameInput = dialog.locator('input[type="text"]').first();
    await setValueVueInput(nameInput, 'Narrow segment');
    expect(await nameInput.inputValue()).toBe('Narrow segment');
    await volview.editLabelModalDoneButton.scrollIntoViewIfNeeded();
    await volview.editLabelModalDoneButton.click();
    await expect(dialog).toBeHidden();
    await page.setViewportSize(CONTENT_VIEWPORT);
    await segmentation.openAnnotationSegments();
    expect(await segmentation.segmentNames()).toEqual(['Narrow segment']);
    expect(await segmentation.segmentColor('Narrow segment')).not.toBe(
      originalColor
    );
  });
});
