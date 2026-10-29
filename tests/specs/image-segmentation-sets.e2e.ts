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
  dropImageOnView,
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
import {
  buildSyntheticCineDicom,
  buildSyntheticDicom,
  newUid,
} from './syntheticDicom';

const FIRST = 'segment-owner-a.mha';
const SECOND = 'segment-owner-b.mha';
const THIRD = 'segment-owner-c.mha';
const volumeCards = () => $$('.image-list-card');
const active2DView = () =>
  $('.grid-item[style*="mediumseagreen"] [data-testid~="vtk-two-view"]');

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
  await volViewPage.waitForLoadingIndicator(active2DView());
};

const paint = async () => {
  const view = active2DView();
  await view.waitForDisplayed();
  await volViewPage.paintStrokeOnView(view);
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
  await volViewPage.open(`?urls=[tmp/${FIRST}]`);
  await volViewPage.waitForViews();
  await openThroughDialog(path.join(TEMP_DIR, SECOND));
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

const openSixViewLayout = async () => {
  await volViewPage.layoutButton.click();
  const gridCell = $('.v-menu .grid-cell:nth-child(6) .grid-cell-box');
  await gridCell.waitForDisplayed();
  await gridCell.waitForStable();
  await gridCell.moveTo();
  await gridCell.click();
  await expect($$('.grid-item')).toBeElementsArrayOfSize(6);
};

describe('Image segmentation sets', () => {
  it('keeps configured definitions independent for two DICOM series and cine imported together', async () => {
    const folder = 'segment-owner-dicom-batch';
    const directory = makeTempDir(folder);
    const studyUid = newUid();
    const resources: string[] = [];
    for (const seriesNumber of [101, 202]) {
      const seriesUid = newUid();
      for (let slice = 0; slice < 2; slice++) {
        const filename = `series-${seriesNumber}-${slice}.dcm`;
        writeFileSync(
          path.join(directory, filename),
          buildSyntheticDicom({
            studyUid,
            seriesUid,
            sopUid: newUid(),
            seriesNumber,
            instanceNumber: slice + 1,
            imageOrientationPatient: [1, 0, 0, 0, 1, 0],
            imagePositionPatient: [0, 0, slice],
            rows: 16,
            cols: 16,
            pixelValue: seriesNumber + slice,
          })
        );
        resources.push(`tmp/${folder}/${filename}`);
      }
    }
    writeFileSync(
      path.join(directory, 'cine.dcm'),
      buildSyntheticCineDicom({
        studyUid,
        seriesUid: newUid(),
        sopUid: newUid(),
        seriesNumber: 303,
        rows: 16,
        cols: 16,
      })
    );
    writeFileSync(
      path.join(directory, 'config.json'),
      JSON.stringify({ segments: { Tumor: { color: 'red' }, Liver: {} } })
    );
    resources.push(`tmp/${folder}/cine.dcm`, `tmp/${folder}/config.json`);
    await volViewPage.open(`?urls=[${resources.join(',')}]`);
    await volViewPage.waitForViews();
    await expect($$('.volume-card')).toBeElementsArrayOfSize(3);

    const showSeries = async (name: string) => {
      await $('button[data-testid="module-tab-Data"]').click();
      await waitForModuleTransitions();
      const titles = await $$('.volume-card .series-desc .text-ellipsis');
      const names = await titles.map((title) => title.getText());
      expect(names).toContain(name);
      const title = titles[names.indexOf(name)];
      await title.scrollIntoView();
      await title.waitForClickable();
      await title.click();
      await openAnnotationSegments();
      await expect($('[data-testid="segment-image-name"]')).toHaveText(name);
    };

    await showSeries('101');
    await expectSegments(['Tumor', 'Liver']);
    await renameSegment('Tumor', 'Lesion');
    await showSeries('202');
    await expectSegments(['Tumor', 'Liver']);
    await showSeries('Synthetic cine');
    await expectSegments(['Tumor', 'Liver']);
    await expect($('[data-testid~="vtk-cine-view"]')).toBeDisplayed();
    await showSeries('101');
    await expectSegments(['Lesion', 'Liver']);
    expect(await volViewPage.getNotificationsCount()).toEqual(0);
  });

  it('copies reordered definitions and a nonfirst selection through an empty view', async () => {
    await openImages();
    await createSourceDefinitions();
    await volViewPage.selectTool('mdi-cursor-default');
    await (await segmentRow('Liver')).$('.reorder-handle').click();
    await browser.keys(['Alt', 'ArrowUp']);
    await expectSegments(['Liver', 'Tumor']);
    expect(await selectedSegmentName()).toEqual('Tumor');

    await openSixViewLayout();
    await expect($$('.grid-item')[4].$('.overlay')).toBeDisplayed();
    await dropImageOnView(SECOND, 4);
    await openAnnotationSegments();

    await expect($('[data-testid="segment-image-name"]')).toHaveText(SECOND);
    await expectSegments(['Liver', 'Tumor']);
    expect(await selectedSegmentName()).toEqual('Tumor');
    await expect(
      (await segmentRow('Tumor')).$('[data-testid="reveal-segment-button"]')
    ).toBeDisabled();
  });

  it('copies the active image definitions when replacing another populated view', async () => {
    for (const [index, name] of [FIRST, SECOND, THIRD].entries())
      writeMetaImage(name, { size: 32, step: index + 3 });
    await volViewPage.open(`?urls=[tmp/${FIRST}]`);
    await volViewPage.waitForViews();
    await showImage(FIRST);
    await createSourceDefinitions();

    await expectSegments(['Tumor', 'Liver']);
    const destinations = await writeManifestToFile(
      {
        resources: [
          { url: `/tmp/${SECOND}`, name: SECOND },
          { url: `/tmp/${THIRD}`, name: THIRD },
        ],
      },
      'segment-owner-drop-destinations.json'
    );
    await openThroughDialog(destinations);
    await expect(volumeCards()).toBeElementsArrayOfSize(3);
    await openAnnotationSegments();
    await expect($('[data-testid="segment-image-name"]')).toHaveText(FIRST);
    await expectSegments(['Tumor', 'Liver']);

    await showImage(SECOND);
    await deleteSegment('Tumor');
    await deleteSegment('Liver');
    await addSegment();
    await renameSegment('Segment 1', 'Kidney');
    await expectSegments(['Kidney']);
    await showImage(FIRST);
    await volViewPage.selectTool('mdi-cursor-default');

    await openSixViewLayout();
    await dropImageOnView(SECOND, 4);
    await $$('.grid-item')[0].$('canvas').click();
    await openAnnotationSegments();
    await expect($('[data-testid="segment-image-name"]')).toHaveText(FIRST);

    await dropImageOnView(THIRD, 4);
    await openAnnotationSegments();
    await expect($('[data-testid="segment-image-name"]')).toHaveText(THIRD);
    await expectSegments(['Tumor', 'Liver']);
    expect(await selectedSegmentName()).toEqual('Tumor');
    await showImage(SECOND);
    await expectSegments(['Kidney']);
    expect(await volViewPage.getNotificationsCount()).toEqual(0);
  });

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
    const competingDefaults = await writeManifestToFile(
      { segments: { Tumor: {}, Liver: {} } },
      'segment-owner-competing-defaults.json'
    );
    await openThroughDialog(competingDefaults);
    await expectSegments(['Tumor', 'Liver']);
    await showImage(SECOND);
    await expectSegments(['Tumor', 'Liver']);
    await deleteSegment('Tumor');
    await deleteSegment('Liver');
    await expectSegments([]);
    await showImage(FIRST);
    await waitForSegmentContent('Tumor');
    await showImage(SECOND);
    await expectSegments([]);

    // Save with the populated image active so a lost empty set would borrow it.
    await showImage(FIRST);
    await expectSegments(['Tumor', 'Liver']);
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
