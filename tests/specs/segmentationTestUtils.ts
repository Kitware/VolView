import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';

const SEGMENT_LIST = '[data-testid="segment-list"]';
const LABEL_LIST = '[data-testid="tool-label-list"]';

// Only a chip standing for a real item carries a title span; the trailing
// "create" chip does not.
const namesIn = (root: string) =>
  $$(`${root} .v-chip .text-truncate`).map((title) => title.getText());

const chipNamed = async (root: string, name: string) => {
  const chips = await $$(`${root} .v-chip`);
  for (const chip of chips) {
    const title = await chip.$('.text-truncate');
    if ((await title.isExisting()) && (await title.getText()) === name) {
      return chip;
    }
  }
  throw new Error(`No chip named "${name}" under ${root}`);
};

const dotColor = async (root: string, name: string) => {
  const chip = await chipNamed(root, name);
  const dot = await chip.$('.color-dot');
  return (await dot.getCSSProperty('background-color')).value;
};

// The list's trailing "create" chip is the one carrying the plus icon.
const addChip = async (root: string) => {
  const before = await namesIn(root);
  await $(`${root} .v-chip i[class~="mdi-plus"]`).click();
  await browser.waitUntil(
    async () => (await namesIn(root)).length === before.length + 1,
    { timeoutMsg: `Expected the create chip to add an item under ${root}` }
  );
};

const editDialog = () => $('div[role="dialog"]');

const renameInOpenDialog = async (to: string) => {
  const dialog = editDialog();
  await dialog.waitForDisplayed();
  // Name is the first text field in both the segment and the tool-label editor.
  await setValueVueInput(dialog.$('.v-text-field input'), to);
  await volViewPage.editLabelModalDoneButton.click();
  await dialog.waitForDisplayed({ reverse: true });
};

export const segmentNames = () => namesIn(SEGMENT_LIST);
const labelNames = () => namesIn(LABEL_LIST);

export const segmentColor = (name: string) => dotColor(SEGMENT_LIST, name);
export const labelColor = (name: string) => dotColor(LABEL_LIST, name);

export const addSegment = () => addChip(SEGMENT_LIST);
export const addLabel = () => addChip(LABEL_LIST);

export const selectSegment = async (name: string) => {
  const chip = await chipNamed(SEGMENT_LIST, name);
  await chip.click();
};

export const renameSegment = async (from: string, to: string) => {
  const chip = await chipNamed(SEGMENT_LIST, from);
  await chip.$('button i[class~="mdi-pencil"]').click();
  await renameInOpenDialog(to);
  await browser.waitUntil(async () => (await segmentNames()).includes(to), {
    timeoutMsg: `Expected the segment list to show "${to}"`,
  });
};

export const renameLabel = async (from: string, to: string) => {
  const chip = await chipNamed(LABEL_LIST, from);
  await chip.$('button[data-testid="edit-label-button"]').click();
  await renameInOpenDialog(to);
  await browser.waitUntil(async () => (await labelNames()).includes(to), {
    timeoutMsg: `Expected the label list to show "${to}"`,
  });
};

export const openAnnotationSegments = async () => {
  await volViewPage.annotationsModuleTab.click();
  const tab = volViewPage.segmentsTab;
  await tab.waitForClickable();
  await tab.click();
};

// The panel is one flat list scoped to the viewed image, so what used to be a
// group is now just the segments that image has.
export const segmentGroupNames = segmentNames;

/**
 * The list follows the viewed image, so there is nothing left to pick; the wait
 * stays, because the list renders empty until the image's segments arrive.
 */
export const showFirstSegmentGroup = async (timeout?: number) => {
  await $(SEGMENT_LIST).waitForDisplayed(timeout ? { timeout } : undefined);
  await browser.waitUntil(async () => (await segmentNames()).length >= 1, {
    ...(timeout ? { timeout } : {}),
    timeoutMsg: 'Expected the viewed image to have a segment',
  });
};
