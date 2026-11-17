import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  openThroughDialog,
  overlayOption,
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
  openAnnotationSegments,
  renameSegment,
  segmentNames,
  selectSegment,
  waitForSegmentContent,
  segmentImageName,
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

// The restored Paint tool switches the side panel to Annotations once applied.
const restorePaintSession = async (savedPath: string) => {
  await openThroughDialog(savedPath);
  await volViewPage.waitForViews();
  await expect($('[data-testid="module-tab-Annotations"]')).toHaveAttribute(
    'aria-selected',
    'true'
  );
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

const openSparseSession = async (activeView?: string) => {
  writeMetaImage(THIRD, { size: 32, step: 7 });
  const manifest = await writeManifestToFile(
    {
      version: '8.0.0',
      datasets: [{ id: 'restored', dataSourceId: 1 }],
      dataSources: [{ id: 1, type: 'uri', uri: `/tmp/${THIRD}` }],
      activeView,
    },
    'segment-owner-sparse.volview.json'
  );
  await openThroughDialog(manifest);
  await openAnnotationSegments();
  await expect(segmentImageName()).toHaveText(THIRD);
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
      await expect(segmentImageName()).toHaveText(name);
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

  it('starts images empty without a config when a sparse session reuses a replaced first view', async () => {
    await openImages();
    await addSegment();
    await renameSegment('Segment 1', 'Liver');
    await $$('.grid-item')[0].$('.view-type-select .v-field').click();
    const coronal = overlayOption('Coronal');
    await coronal.waitForClickable();
    await coronal.click();
    await expect($$('.grid-item')[0].$('.view-type-select input')).toHaveValue(
      'Coronal'
    );

    await dropImageOnView(SECOND, 0);
    await openAnnotationSegments();
    await expect(segmentImageName()).toHaveText(SECOND);
    await expectSegments([]);
    await volViewPage.selectTool('mdi-cursor-default');
    await $$('.grid-item')[1].$('canvas').click();
    await expect(segmentImageName()).toHaveText(FIRST);
    await expectSegments(['Liver']);

    await openSparseSession();

    await expectSegments([]);
    await expect($('.grid-item[style*="mediumseagreen"]')).toBeDisplayed();
  });

  it('keeps a visible image selected when a sparse session names an unknown view', async () => {
    await volViewPage.open();

    await openSparseSession('missing-view');

    await expect($('.grid-item[style*="mediumseagreen"]')).toBeDisplayed();
    await addSegment();
    await expectSegments(['Segment 1']);
  });

  it('adds each config to the current image without removing or renaming anything', async () => {
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
    await expectSegments(['Liver', 'Tumor']);

    const standalone = await writeManifestToFile(
      { segments: { Standalone: { color: '#0000ff' } } },
      'segment-owner-standalone.json'
    );
    await openThroughDialog(standalone);
    await expectSegments(['Liver', 'Tumor', 'Standalone']);

    await renameSegment('Standalone', 'Mine');
    await openThroughDialog(standalone);
    await expectSegments(['Liver', 'Tumor', 'Mine', 'Standalone']);
  });

  it('starts a second image empty without a config', async () => {
    await openImages();
    await createSourceDefinitions();

    await showImage(SECOND);
    await expectSegments([]);
    await showImage(FIRST);
    await expectSegments(['Tumor', 'Liver']);
    await waitForSegmentContent('Tumor');
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

    await showImage(FIRST);
    await expectSegments(['Tumor', 'Liver']);
    const filename = await volViewPage.saveSession();
    const savedPath = path.join(TEMP_DIR, filename);
    await waitForDownload(savedPath, SESSION_SAVE_TIMEOUT);
    await volViewPage.open();
    // A lost empty set would be seeded from this config.
    await openThroughDialog(competingDefaults);
    await restorePaintSession(savedPath);
    await showImage(SECOND);
    await expectSegments([]);
    await showImage(FIRST);
    await expectSegments(['Tumor', 'Liver']);
    await waitForSegmentContent('Tumor');
    expect(await volViewPage.getNotificationsCount()).toEqual(0);
  });
});
