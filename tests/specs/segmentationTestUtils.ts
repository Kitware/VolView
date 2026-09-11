import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';

const SEGMENT_LIST = '[data-testid="segment-list"]';
const SHAPE_ROW = '[data-testid="segment-shape-row"]';

// Only a row standing for a real item carries a title; the trailing "create"
// row does not.
const namesIn = (root: string) =>
  $$(`${root} .item-row .v-list-item-title`).map((title) => title.getText());

const rowNamed = async (root: string, name: string) => {
  const rows = await $$(`${root} .item-row`);
  for (const row of rows) {
    const title = await row.$('.v-list-item-title');
    if ((await title.isExisting()) && (await title.getText()) === name) {
      return row;
    }
  }
  throw new Error(`No row named "${name}" under ${root}`);
};

const dotColor = async (root: string, name: string) => {
  const row = await rowNamed(root, name);
  const dot = await row.$('.color-dot');
  return (await dot.getCSSProperty('background-color')).value;
};

const addRow = async (root: string) => {
  const before = await namesIn(root);
  await $(`${root} .create-row`).click();
  await browser.waitUntil(
    async () => (await namesIn(root)).length === before.length + 1,
    { timeoutMsg: `Expected the create row to add an item under ${root}` }
  );
};

const editDialog = () => $('div[role="dialog"]');

const renameInOpenDialog = async (to: string) => {
  const dialog = editDialog();
  await dialog.waitForDisplayed();
  // Name is the first text field in the editor both lists open.
  await setValueVueInput(dialog.$('.v-text-field input'), to);
  await volViewPage.editLabelModalDoneButton.click();
  await dialog.waitForDisplayed({ reverse: true });
};

export const segmentNames = () => namesIn(SEGMENT_LIST);

export const segmentRow = (name: string) => rowNamed(SEGMENT_LIST, name);

/** Waits for mask or shape content, which may arrive after the catalog name. */
export const waitForSegmentContent = async (name: string, timeout?: number) => {
  const row = await segmentRow(name);
  await row
    .$('button[data-testid="reveal-segment-button"]')
    .waitForEnabled(timeout ? { timeout } : undefined);
};

export const segmentColor = (name: string) => dotColor(SEGMENT_LIST, name);

export const addSegment = () => addRow(SEGMENT_LIST);

export const selectSegment = async (name: string) => {
  const row = await rowNamed(SEGMENT_LIST, name);
  // Clicking the title rather than the row keeps the hit away from the
  // right-aligned controls on a narrow sidebar.
  await row.$('.v-list-item-title').click();
};

/** The row the list marks active, which is what a tool draws with. */
export const selectedSegmentName = () =>
  $(
    `${SEGMENT_LIST} .item-row.v-list-item--active .v-list-item-title`
  ).getText();

/** Page-coordinate top of the Segments list, for asserting it has not moved. */
export const segmentListTop = async () =>
  (await $(SEGMENT_LIST).getLocation()).y;

const deleteIn = async (root: string, name: string) => {
  const row = await rowNamed(root, name);
  await row.$('button i[class~="mdi-delete"]').click();
  await browser.waitUntil(async () => !(await namesIn(root)).includes(name), {
    timeoutMsg: `Expected "${name}" to leave ${root}`,
  });
};

export const deleteSegment = (name: string) => deleteIn(SEGMENT_LIST, name);

/** Puts the 2D views on the middle of what this image stores for a segment. */
export const revealSegment = async (name: string) => {
  const row = await rowNamed(SEGMENT_LIST, name);
  const button = await row.$('button[data-testid="reveal-segment-button"]');
  await button.waitForClickable();
  await button.click();
};

const renameIn = async (root: string, from: string, to: string) => {
  const row = await rowNamed(root, from);
  await row.$('button[data-testid="edit-segment-button"]').click();
  await renameInOpenDialog(to);
  await browser.waitUntil(async () => (await namesIn(root)).includes(to), {
    timeoutMsg: `Expected ${root} to show "${to}"`,
  });
};

export const renameSegment = (from: string, to: string) =>
  renameIn(SEGMENT_LIST, from, to);

/** The Segments list is pinned at the top of the Annotations panel. */
export const openAnnotationSegments = async () => {
  await volViewPage.annotationsModuleTab.click();
  await $(SEGMENT_LIST).waitForDisplayed();
};

/** Opens the flat list of rulers, rectangles and polygons on the viewed image. */
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

/** Waits for the viewed image to render at least one named segment. */
export const waitForNamedSegments = async (timeout?: number) => {
  await $(SEGMENT_LIST).waitForDisplayed(timeout ? { timeout } : undefined);
  // A row renders before its title does, so a name-less row is not yet a
  // segment the caller can read.
  await browser.waitUntil(
    async () => {
      const names = await segmentNames();
      return names.length >= 1 && names.every((name) => name.length > 0);
    },
    {
      ...(timeout ? { timeout } : {}),
      timeoutMsg: 'Expected the viewed image to have a named segment',
    }
  );
};

/**
 * Locks a segment, which is the whole opt-in for overlap: a locked segment
 * keeps the voxels a later stroke paints over it.
 */
export const lockSegment = async (name: string) => {
  const row = await rowNamed(SEGMENT_LIST, name);
  await row.$('button i[class~="mdi-lock-open"]').click();
  await row.$('button i[class~="mdi-lock"]').waitForExist({
    timeoutMsg: `Expected "${name}" to show as locked`,
  });
};
