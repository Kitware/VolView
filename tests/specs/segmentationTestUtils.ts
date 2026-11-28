import { IMAGE_DRAG_MEDIA_TYPE } from '@/src/constants';
import { expect, type Locator, type Page } from '@playwright/test';
import {
  createVolViewPage,
  containsText,
  exactText,
  holdKey,
  setValueVueInput,
  waitForTransitions,
} from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import { createUtils } from './utils';

const SEGMENT_LIST = '[data-testid="segment-list"]';
const SHAPE_ROW = '[data-testid="segment-shape-row"]';

const eyeButton = (visible: boolean) =>
  'button:has(i.' + (visible ? 'mdi-eye' : 'mdi-eye-off') + ')';

export const createSegmentationUtils = (page: Page, scratch: Scratch) => {
  const volview = createVolViewPage(page, scratch);
  const utils = createUtils(page, scratch);
  const segmentList = page.locator(SEGMENT_LIST);

  // Only a row standing for a real item carries a title; the trailing "create"
  // row does not.
  const segmentNames = () =>
    page
      .locator(`${SEGMENT_LIST} .item-row .v-list-item-title`)
      .allInnerTexts();

  // Rows arrive after the image renders: an import or restore mints its
  // segments once the labelmap is read, so a row is waited for rather than
  // looked up once.
  const segmentRow = async (name: string) => {
    const row = page
      .locator(`${SEGMENT_LIST} .item-row`)
      .filter({
        has: page.locator('.v-list-item-title', { hasText: exactText(name) }),
      })
      .first();
    await expect(row, `No segment named "${name}"`).toBeAttached();
    return row;
  };

  const setSegmentVisible = async (name: string, visible: boolean) => {
    const row = await segmentRow(name);
    if (await row.locator(eyeButton(!visible)).count())
      await row.locator(eyeButton(!visible)).click();
    await expect(row.locator(eyeButton(visible))).toBeAttached();
  };

  /** The color dot's computed `background-color`, as an `rgb()` string. */
  const segmentColor = async (name: string) => {
    const row = await segmentRow(name);
    return row
      .locator('.color-dot')
      .evaluate((dot) => getComputedStyle(dot).backgroundColor);
  };

  const createSegmentRow = () => page.locator(`${SEGMENT_LIST} .create-row`);

  const copySegmentsRow = () =>
    page.locator(`${SEGMENT_LIST} .copy-segments-row`);

  /** A source in the open copy menu, titled by image name above its count. */
  const copySource = (imageName: string) =>
    page.locator('div.v-overlay--active div.v-list-item').filter({
      has: page.locator('div.v-list-item-title', {
        hasText: exactText(imageName),
      }),
    });

  const openCopySegmentsMenu = async () => {
    await copySegmentsRow().click();
    const menu = page.locator('.v-menu.v-overlay--active .v-overlay__content');
    await expect(menu).toBeVisible();
    // The menu ignores the pointer until its opening transition ends.
    await expect(menu).not.toHaveCSS('pointer-events', 'none');
  };

  const copySegmentsFrom = async (imageName: string) => {
    await openCopySegmentsMenu();
    const source = copySource(imageName);
    // The active class leaves on close, so follow the element itself out.
    const element = await source.elementHandle();
    await source.click();
    await element?.waitForElementState('hidden');
  };

  /** The image whose segments the panel lists: the active view's image. */
  // The image name is the first span; orientation letters follow it.
  const segmentImageName = () =>
    page
      .locator(
        '.grid-item[style*="mediumseagreen"] .view-annotations .annotation-cell > span'
      )
      .first();

  const addSegment = async () => {
    const before = await segmentNames();
    await createSegmentRow().click();
    await expect
      .poll(async () => (await segmentNames()).length, {
        message: 'Expected the create row to add a segment',
      })
      .toBe(before.length + 1);
  };

  const editDialog = () => page.locator('div[role="dialog"]').first();

  const renameInOpenDialog = async (to: string) => {
    const dialog = editDialog();
    await expect(dialog).toBeVisible();
    // The segment editor puts its name field before the numeric fields.
    await setValueVueInput(dialog.locator('.v-text-field input').first(), to);
    await volview.editLabelModalDoneButton.click();
    await expect(dialog).toBeHidden();
  };

  /**
   * Waits for mask or shape content, which arrives after the catalog name: a
   * restore lists its segments, then reads their masks. How long that takes is
   * the load's business, so this waits for the list to say the load is over
   * instead of giving the content a time of its own.
   */
  const waitForSegmentContent = async (name: string) => {
    const row = await segmentRow(name);
    await expect(
      segmentList,
      'Expected the scene to finish loading'
    ).not.toHaveAttribute('aria-busy', 'true');
    await expect(
      row.locator('button[data-testid="reveal-segment-button"]')
    ).toBeEnabled();
  };

  const selectSegment = async (name: string) => {
    const row = await segmentRow(name);
    // Clicking the title rather than the row keeps the hit away from the
    // right-aligned controls on a narrow sidebar.
    await row.locator('.v-list-item-title').click();
  };

  const selectedSegmentName = () =>
    page
      .locator(
        `${SEGMENT_LIST} .item-row.v-list-item--active .v-list-item-title`
      )
      .innerText();

  const imageCard = (name: string) =>
    page.locator(`.image-list-card:has([title="${name}"])`);

  /** Views an imported image by clicking its card in the Data tab. */
  const clickImageCard = async (name: string) => {
    await page.locator('button[data-testid="module-tab-Data"]').click();
    await utils.waitForModuleTransitions();
    const card = imageCard(name);
    await card.click();
    await expect(card).toHaveClass(/image-list-card-active/);
  };

  /** Drops an imported image's card onto a layout slot through its DOM handlers. */
  const dropImageOnView = async (name: string, slotIndex: number) => {
    await page.locator('button[data-testid="module-tab-Data"]').click();
    const card = imageCard(name);
    await expect(card).toBeVisible();
    const destination = await page
      .locator('.grid-item')
      .nth(slotIndex)
      .elementHandle();
    await card.evaluate(
      (source, { target, mediaType }) => {
        const transfer = new DataTransfer();
        const dispatch = (element: Element, type: string) =>
          element.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer,
            })
          );
        dispatch(source, 'dragstart');
        if (!transfer.getData(mediaType))
          throw new Error('Image drag did not provide an image identifier');
        dispatch(target!, 'dragenter');
        dispatch(target!, 'drop');
      },
      { target: destination, mediaType: IMAGE_DRAG_MEDIA_TYPE }
    );
  };

  /** Viewport top of the Segments list, for asserting it has not moved. */
  const segmentListTop = async () => (await segmentList.boundingBox())?.y;

  const deleteSegment = async (name: string) => {
    const row = await segmentRow(name);
    await row.locator('button i[class~="mdi-delete"]').click();
    await expect
      .poll(segmentNames, {
        message: `Expected segment "${name}" to be removed`,
      })
      .not.toContain(name);
  };

  const revealSegment = async (name: string) => {
    const row = await segmentRow(name);
    await row.locator('button[data-testid="reveal-segment-button"]').click();
  };

  const renameSegment = async (from: string, to: string) => {
    const row = await segmentRow(from);
    await row.locator('button[data-testid="edit-segment-button"]').click();
    await renameInOpenDialog(to);
    await expect
      .poll(segmentNames, { message: `Expected a segment named "${to}"` })
      .toContain(to);
  };

  const recolorSegment = async (name: string, red: number) => {
    const row = await segmentRow(name);
    await row.locator('[data-testid="edit-segment-button"]').click();
    const dialog = editDialog();
    await expect(dialog).toBeVisible();
    await setValueVueInput(
      dialog.locator('.v-color-picker-edit input').first(),
      String(red)
    );
    await volview.editLabelModalDoneButton.click();
    await expect(dialog).toBeHidden();
  };

  /** The Segments list is pinned at the top of the Annotations panel. */
  const openAnnotationSegments = async () => {
    await volview.annotationsModuleTab.click();
    await expect(segmentList).toBeVisible();
    // Selecting a tool slides this panel in, and a click aimed at a row that is
    // still moving lands on its neighbour.
    await waitForTransitions(segmentList);
  };

  const openSegmentShapes = async () => {
    await volview.annotationsModuleTab.click();
    const section = page.locator('[data-testid="measurements-section"]');
    await expect(section).toBeEnabled();
    if ((await section.getAttribute('aria-expanded')) === 'false')
      await section.click();
    await expect(page.locator(SHAPE_ROW).first()).toBeVisible();
  };

  /** One line per shape: where it sits, and a ruler's length. */
  const shapeRowTexts = () => page.locator(SHAPE_ROW).allInnerTexts();

  const waitForNamedSegments = async () => {
    await expect(segmentList).toBeVisible();
    // A row renders before its title does, so a name-less row is not yet a
    // segment the caller can read.
    await expect
      .poll(
        async () => {
          const names = await segmentNames();
          return names.length >= 1 && names.every((name) => name.length > 0);
        },
        { message: 'Expected the viewed image to have a named segment' }
      )
      .toBe(true);
  };

  /** Locks a segment: a later stroke of another segment goes around it. */
  const lockSegment = async (name: string) => {
    const row = await segmentRow(name);
    await row.locator('button i[class~="mdi-lock-open"]').click();
    await expect(
      row.locator('button i[class~="mdi-lock"]'),
      `Expected "${name}" to show as locked`
    ).toBeAttached();
  };

  /** Turns on Allow Overlap, opening the Paint panel it lives in if it was closed. */
  const allowOverlap = async () => {
    const panel = page.locator('button.v-expansion-panel-title', {
      hasText: containsText('Paint'),
    });
    if ((await panel.getAttribute('aria-expanded')) !== 'true')
      await panel.click();
    const toggle = page.locator('input[aria-label="Allow Overlap"]');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
  };

  /** The tooltip an element's hover or focus is showing. */
  const tooltipOf = async (element: Locator) => {
    const id = await element.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    return page.locator(`[id="${id}"]`);
  };

  const setSegmentationDisplaySlider = async (name: string, value: number) => {
    const slider = page.locator(
      `${SEGMENT_LIST} [role="slider"][aria-label="${name}"]`
    );
    await slider.evaluate((element) =>
      element.scrollIntoView({ block: 'center' })
    );
    await slider.click();
    const step = name === 'Outline Thickness' ? 1 : 0.01;
    await page.keyboard.press('Home');
    await holdKey(page, 'ArrowRight', Math.round(value / step));
    await expect(slider).toHaveAttribute('aria-valuenow', String(value));
  };

  const openSegmentDisplay = async () => {
    await openAnnotationSegments();
    const display = page.locator('[data-testid="segment-display-section"]');
    if ((await display.getAttribute('aria-expanded')) !== 'true')
      await display.click();
  };

  return {
    segmentNames,
    segmentRow,
    setSegmentVisible,
    segmentColor,
    createSegmentRow,
    copySegmentsRow,
    copySource,
    openCopySegmentsMenu,
    copySegmentsFrom,
    segmentImageName,
    addSegment,
    waitForSegmentContent,
    selectSegment,
    selectedSegmentName,
    clickImageCard,
    dropImageOnView,
    segmentListTop,
    deleteSegment,
    revealSegment,
    renameSegment,
    recolorSegment,
    openAnnotationSegments,
    openSegmentShapes,
    shapeRowTexts,
    waitForNamedSegments,
    lockSegment,
    allowOverlap,
    tooltipOf,
    setSegmentationDisplaySlider,
    openSegmentDisplay,
  };
};

export type SegmentationUtils = ReturnType<typeof createSegmentationUtils>;
