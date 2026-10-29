import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  openThroughDialog,
  makeTempDir,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  waitForModuleTransitions,
  writeMetaImage,
  writeManifestToFile,
} from './utils';
import {
  addSegment,
  deleteSegment,
  lockSegment,
  openAnnotationSegments,
  renameSegment,
  segmentColor,
  segmentNames,
  segmentRow,
  selectedSegmentName,
  selectSegment,
  waitForSegmentContent,
} from './segmentationTestUtils';

const FIRST = 'segment-owner-a.mha';
const SECOND = 'segment-owner-b.mha';
const volumeCards = () => $$('.image-list-card');

const showImage = async (name: string) => {
  await $('button[data-testid="module-tab-Data"]').click();
  await waitForModuleTransitions();
  const card = $(`.image-list-card:has([title="${name}"])`);
  await card.waitForDisplayed();
  await card.scrollIntoView();
  await card.waitForClickable();
  await card.click();
  await browser.waitUntil(async () =>
    ((await card.getAttribute('class')) ?? '').includes(
      'image-list-card-active'
    )
  );
  await openAnnotationSegments();
  const views = await volViewPage.getViews2D();
  await volViewPage.waitForLoadingIndicator(views[0]);
};

const paint = async () => {
  const views = await volViewPage.getViews2D();
  await volViewPage.paintStrokeOnView(views[0]);
};

const expectSegments = async (names: string[]) => {
  await browser.waitUntil(
    async () => JSON.stringify(await segmentNames()) === JSON.stringify(names),
    { timeoutMsg: `Expected segment list ${names.join(', ')}` }
  );
  expect(await segmentNames()).toEqual(names);
};

const openImages = async () => {
  writeMetaImage(FIRST, { size: 32, step: 3 });
  writeMetaImage(SECOND, { size: 32, step: 5 });
  await volViewPage.open(`?urls=[tmp/${FIRST},tmp/${SECOND}]`);
  await volViewPage.waitForViews();
  await browser.waitUntil(async () => (await volumeCards().length) === 2);
  await showImage(FIRST);
};

const createSourceDefinitions = async () => {
  await volViewPage.activatePaint();
  await paint();
  await openAnnotationSegments();
  await addSegment();
  await renameSegment('Segment 2', 'Liver');
  await renameSegment('Segment 1', 'Tumor');
  await selectSegment('Tumor');
  await waitForSegmentContent('Tumor');
};

describe('Image segmentation sets', () => {
  it('keeps a failed companion image config off the current image and accepts a standalone config', async () => {
    writeMetaImage(FIRST, { size: 32 });
    await writeManifestToFile(
      { segments: { Liver: { color: '#ff0000' } } },
      'segment-owner-initial.json'
    );
    await volViewPage.open(
      `?urls=[tmp/${FIRST},tmp/segment-owner-initial.json]`
    );
    await volViewPage.waitForViews();
    await openAnnotationSegments();
    await expectSegments(['Liver']);

    const directory = makeTempDir('segment-owner-failed-import');
    writeFileSync(path.join(directory, 'broken.vti'), 'not VTI');
    writeFileSync(
      path.join(directory, 'companion.json'),
      JSON.stringify({ segments: { Tumor: { color: '#00ff00' } } })
    );
    const manifest = await writeManifestToFile(
      {
        resources: [
          { url: '/tmp/segment-owner-failed-import/broken.vti' },
          { url: '/tmp/segment-owner-failed-import/companion.json' },
        ],
      },
      'segment-owner-failed-resources.json'
    );
    await openThroughDialog(manifest);
    await volViewPage.waitForNotification();
    await expectSegments(['Liver']);

    const standalone = await writeManifestToFile(
      { segments: { Standalone: { color: '#0000ff' } } },
      'segment-owner-standalone.json'
    );
    await openThroughDialog(standalone);
    await expectSegments(['Standalone']);
  });

  it('copies definitions once and keeps edits and deletion on their image', async () => {
    await openImages();
    await createSourceDefinitions();
    const originalColor = await segmentColor('Tumor');

    await showImage(SECOND);
    await expectSegments(['Tumor', 'Liver']);
    expect(await selectedSegmentName()).toEqual('Tumor');
    expect(await segmentColor('Tumor')).toEqual(originalColor);
    await expect(
      (await segmentRow('Tumor')).$('[data-testid="reveal-segment-button"]')
    ).toBeDisabled();
    await expect(volViewPage.saveSegmentsButtons[0]).toBeDisabled();

    await renameSegment('Tumor', 'Lesion');
    await (await segmentRow('Lesion'))
      .$('[data-testid="edit-segment-button"]')
      .click();
    const dialog = $('div[role="dialog"]');
    await dialog.waitForDisplayed();
    await setValueVueInput(dialog.$('.v-color-picker-edit input'), '64');
    await volViewPage.editLabelModalDoneButton.click();
    await dialog.waitForDisplayed({ reverse: true });
    const secondColor = await segmentColor('Lesion');
    expect(secondColor).not.toEqual(originalColor);
    await paint();
    await waitForSegmentContent('Lesion');
    await lockSegment('Liver');
    await (await segmentRow('Liver'))
      .$('button[aria-label="Hide Liver"]')
      .click();

    await showImage(FIRST);
    await expectSegments(['Tumor', 'Liver']);
    expect(await selectedSegmentName()).toEqual('Tumor');
    expect(await segmentColor('Tumor')).toEqual(originalColor);
    await waitForSegmentContent('Tumor');
    await expect(
      (await segmentRow('Liver')).$('button[aria-label="Lock Liver"]')
    ).toExist();
    await expect(
      (await segmentRow('Liver')).$('button[aria-label="Hide Liver"]')
    ).toExist();

    await showImage(SECOND);
    await expectSegments(['Lesion', 'Liver']);
    expect(await segmentColor('Lesion')).toEqual(secondColor);
    await deleteSegment('Lesion');
    await showImage(FIRST);
    await expectSegments(['Tumor', 'Liver']);
    await waitForSegmentContent('Tumor');
    await expect(volViewPage.saveSegmentsButtons[0]).toBeEnabled();
  });

  it('preserves a deliberately empty set through switching and session restore', async () => {
    await openImages();
    await createSourceDefinitions();
    await showImage(SECOND);
    await expectSegments(['Tumor', 'Liver']);
    await deleteSegment('Tumor');
    await deleteSegment('Liver');
    await expectSegments([]);
    await showImage(FIRST);
    await waitForSegmentContent('Tumor');
    await showImage(SECOND);
    await expectSegments([]);

    const filename = await volViewPage.saveSession();
    const savedPath = path.join(TEMP_DIR, filename);
    await waitForDownload(savedPath, SESSION_SAVE_TIMEOUT);
    await volViewPage.open();
    await openThroughDialog(savedPath);
    await volViewPage.waitForViews();
    await showImage(SECOND);
    await expectSegments([]);
    await showImage(FIRST);
    await expectSegments(['Tumor', 'Liver']);
    await waitForSegmentContent('Tumor');
    expect(await volViewPage.getNotificationsCount()).toEqual(0);
  });
});
