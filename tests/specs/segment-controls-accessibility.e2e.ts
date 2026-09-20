import { Key } from 'webdriverio';
import { CONTENT_VIEWPORT } from '../../wdio.shared.conf';
import AppPage, { setValueVueInput } from '../pageobjects/volview.page';
import { ONE_CT_SLICE_DICOM } from '../datasets';
import {
  openAnnotationSegments,
  segmentColor,
  segmentNames,
  segmentRow,
  waitForNamedSegments,
} from './segmentationTestUtils';
import { openUrls } from './utils';

describe('Segment control accessibility', () => {
  beforeEach(async () => {
    await openUrls([ONE_CT_SLICE_DICOM]);
  });

  afterEach(async () => {
    await browser.setViewport({ ...CONTENT_VIEWPORT, devicePixelRatio: 1 });
  });

  it('names each interactive paint parameter', async () => {
    await AppPage.activatePaint();
    const paintPanel = $('.paint-process-panels .v-expansion-panel-title');
    await paintPanel.click();

    const brush = $('[role="slider"][aria-label="Brush size"]');
    await brush.waitForDisplayed();
    const initialSize = await brush.getAttribute('aria-valuenow');
    await brush.execute((element) => element.focus());
    await browser.keys(Key.ArrowRight);
    expect(await brush.getAttribute('aria-valuenow')).not.toBe(initialSize);

    const minimum = $('input[aria-label="Minimum threshold"]');
    const maximum = $('input[aria-label="Maximum threshold"]');
    await minimum.waitForDisplayed();
    await expect(maximum).toBeDisplayed();
    await expect(
      $('[role="slider"][aria-label="Minimum threshold"]')
    ).toBeDisplayed();
    await expect(
      $('[role="slider"][aria-label="Maximum threshold"]')
    ).toBeDisplayed();
    const sync = $('input[aria-label="Sync Views"]');
    await expect(sync).toExist();
    expect(await sync.getComputedRole()).toBe('checkbox');
    const initiallySelected = await sync.isSelected();
    await sync.execute((element) => element.focus());
    await browser.keys(' ');
    expect(await sync.isSelected()).toBe(!initiallySelected);
  });

  it('keeps the segment editor usable at 375px and side by side on desktop', async () => {
    await AppPage.activatePaint();
    const view = $('div[data-testid~="vtk-two-view"]');
    await AppPage.paintStrokeOnView(view);
    await openAnnotationSegments();
    await waitForNamedSegments();
    const row = await segmentRow('Segment 1');
    const originalColor = await segmentColor('Segment 1');
    await row.$('[data-testid="edit-segment-button"]').click();

    const dialog = $('div[role="dialog"]');
    await dialog.waitForDisplayed();
    const layout = dialog.$('.label-editor-layout');
    const fields = dialog.$('.label-editor-fields');
    const picker = dialog.$('.label-color-picker');
    const desktopLayout = await browser.execute(
      (fieldsElement, pickerElement) => {
        return {
          fieldsLeft: fieldsElement.offsetLeft,
          fieldsWidth: fieldsElement.clientWidth,
          pickerLeft: pickerElement.offsetLeft,
        };
      },
      await fields,
      await picker
    );
    expect(desktopLayout.pickerLeft).toBeGreaterThanOrEqual(
      desktopLayout.fieldsLeft + desktopLayout.fieldsWidth
    );

    await browser.setViewport({
      width: 640,
      height: CONTENT_VIEWPORT.height,
      devicePixelRatio: 1,
    });
    await browser.setViewport({
      width: 375,
      height: CONTENT_VIEWPORT.height,
      devicePixelRatio: 1,
    });
    expect(await browser.execute(() => window.innerWidth)).toBe(375);
    const narrowLayout = await browser.execute(
      (layoutElement, fieldsElement, pickerElement) => {
        return {
          fieldsHeight: fieldsElement.clientHeight,
          pickerOffsetTop: pickerElement.offsetTop,
          pickerWidth: pickerElement.clientWidth,
          layoutWidth: layoutElement.clientWidth,
        };
      },
      await layout,
      await fields,
      await picker
    );
    expect(narrowLayout.pickerWidth).toBeGreaterThan(250);
    expect(narrowLayout.pickerOffsetTop).toBeGreaterThanOrEqual(
      narrowLayout.fieldsHeight
    );
    expect(narrowLayout.pickerWidth).toBeLessThanOrEqual(
      narrowLayout.layoutWidth
    );
    await setValueVueInput(dialog.$('.v-color-picker-edit input'), '0');
    const nameInput = dialog.$('input[type="text"]');
    await setValueVueInput(nameInput, 'Narrow segment');
    expect(await nameInput.getValue()).toBe('Narrow segment');
    await AppPage.editLabelModalDoneButton.scrollIntoView();
    await AppPage.editLabelModalDoneButton.click();
    await dialog.waitForDisplayed({ reverse: true });
    await browser.setViewport({ ...CONTENT_VIEWPORT, devicePixelRatio: 1 });
    await openAnnotationSegments();
    expect(await segmentNames()).toEqual(['Narrow segment']);
    expect(await segmentColor('Narrow segment')).not.toBe(originalColor);
  });
});
