import type { ChainablePromiseElement } from 'webdriverio';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';

const SEGMENT_LIST = '[data-testid="segment-list"]';
const SHAPE_ROW = '[data-testid="segment-shape-row"]';

// Only a row standing for a real item carries a title; the trailing "create"
// row does not.
export const segmentNames = () =>
  $$(`${SEGMENT_LIST} .item-row .v-list-item-title`).map((title) =>
    title.getText()
  );

const findRow = async (name: string) => {
  const rows = await $$(`${SEGMENT_LIST} .item-row`);
  for (const row of rows) {
    const title = await row.$('.v-list-item-title');
    if ((await title.isExisting()) && (await title.getText()) === name) {
      return row;
    }
  }
  return undefined;
};

// Rows arrive after the image renders: an import or restore mints its segments
// once the labelmap is read, so a row is waited for rather than looked up once.
export const segmentRow = async (name: string) => {
  const row = await browser.waitUntil(() => findRow(name), {
    timeoutMsg: `No segment named "${name}"`,
  });
  return row as NonNullable<typeof row>;
};

export const segmentColor = async (name: string) => {
  const row = await segmentRow(name);
  const dot = await row.$('.color-dot');
  return (await dot.getCSSProperty('background-color')).value;
};

export const addSegment = async () => {
  const before = await segmentNames();
  await $(`${SEGMENT_LIST} .create-row`).click();
  await browser.waitUntil(
    async () => (await segmentNames()).length === before.length + 1,
    { timeoutMsg: 'Expected the create row to add a segment' }
  );
};

const editDialog = () => $('div[role="dialog"]');

const renameInOpenDialog = async (to: string) => {
  const dialog = editDialog();
  await dialog.waitForDisplayed();
  // The segment editor puts its name field before the numeric fields.
  await setValueVueInput(dialog.$('.v-text-field input'), to);
  await volViewPage.editLabelModalDoneButton.click();
  await dialog.waitForDisplayed({ reverse: true });
};

/**
 * Waits for mask or shape content, which arrives after the catalog name: a
 * restore lists its segments, then reads their masks. How long that takes is
 * the load's business, so this waits for the list to say the load is over
 * instead of giving the content a time of its own.
 */
export const waitForSegmentContent = async (name: string) => {
  const row = await segmentRow(name);
  await browser.waitUntil(
    async () => (await $(SEGMENT_LIST).getAttribute('aria-busy')) !== 'true',
    { timeoutMsg: 'Expected the scene to finish loading' }
  );
  await row.$('button[data-testid="reveal-segment-button"]').waitForEnabled();
};

export const selectSegment = async (name: string) => {
  const row = await segmentRow(name);
  // Clicking the title rather than the row keeps the hit away from the
  // right-aligned controls on a narrow sidebar.
  await row.$('.v-list-item-title').click();
};

export const selectedSegmentName = () =>
  $(
    `${SEGMENT_LIST} .item-row.v-list-item--active .v-list-item-title`
  ).getText();

/** Page-coordinate top of the Segments list, for asserting it has not moved. */
export const segmentListTop = async () =>
  (await $(SEGMENT_LIST).getLocation()).y;

export const deleteSegment = async (name: string) => {
  const row = await segmentRow(name);
  await row.$('button i[class~="mdi-delete"]').click();
  await browser.waitUntil(async () => !(await segmentNames()).includes(name), {
    timeoutMsg: `Expected segment "${name}" to be removed`,
  });
};

export const revealSegment = async (name: string) => {
  const row = await segmentRow(name);
  const button = await row.$('button[data-testid="reveal-segment-button"]');
  await button.waitForClickable();
  await button.click();
};

export const renameSegment = async (from: string, to: string) => {
  const row = await segmentRow(from);
  await row.$('button[data-testid="edit-segment-button"]').click();
  await renameInOpenDialog(to);
  await browser.waitUntil(async () => (await segmentNames()).includes(to), {
    timeoutMsg: `Expected a segment named "${to}"`,
  });
};

/** The Segments list is pinned at the top of the Annotations panel. */
export const openAnnotationSegments = async () => {
  await volViewPage.annotationsModuleTab.click();
  await $(SEGMENT_LIST).waitForDisplayed();
  // Selecting a tool slides this panel in, and a click aimed at a row that is
  // still moving lands on its neighbour.
  await $(SEGMENT_LIST).waitForStable();
};

export const openSegmentShapes = async () => {
  await volViewPage.annotationsModuleTab.click();
  const section = $('[data-testid="measurements-section"]');
  await section.waitForClickable();
  if ((await section.getAttribute('aria-expanded')) === 'false') {
    await section.click();
  }
  await $(SHAPE_ROW).waitForDisplayed();
};

/** One line per shape: where it sits, and a ruler's length. */
export const shapeRowTexts = () => $$(SHAPE_ROW).map((row) => row.getText());

export const waitForNamedSegments = async () => {
  await $(SEGMENT_LIST).waitForDisplayed();
  // A row renders before its title does, so a name-less row is not yet a
  // segment the caller can read.
  await browser.waitUntil(
    async () => {
      const names = await segmentNames();
      return names.length >= 1 && names.every((name) => name.length > 0);
    },
    { timeoutMsg: 'Expected the viewed image to have a named segment' }
  );
};

/** Locks a segment: a later stroke of another segment goes around it. */
export const lockSegment = async (name: string) => {
  const row = await segmentRow(name);
  await row.$('button i[class~="mdi-lock-open"]').click();
  await row.$('button i[class~="mdi-lock"]').waitForExist({
    timeoutMsg: `Expected "${name}" to show as locked`,
  });
};

/** Turns on Allow Overlap, opening the Paint panel it lives in if it was closed. */
export const allowOverlap = async () => {
  const panel = $('button.v-expansion-panel-title*=Paint');
  if ((await panel.getAttribute('aria-expanded')) !== 'true')
    await panel.click();
  const toggle = $('input[aria-label="Allow Overlap"]');
  await toggle.waitForExist();
  await toggle.execute((element) => element.focus());
  await browser.keys(' ');
  await expect(toggle).toBeSelected();
};

/** The tooltip an element's hover or focus is showing. */
export const tooltipOf = async (element: ChainablePromiseElement) => {
  const id = await element.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  return $(`[id="${id}"]`);
};
