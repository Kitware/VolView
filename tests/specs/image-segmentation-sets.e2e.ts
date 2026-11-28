import path from 'node:path';
import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import type { SegmentationUtils } from './segmentationTestUtils';
import type { Utils } from './utils';
import {
  buildSyntheticCineDicom,
  buildSyntheticDicom,
  newUid,
} from './syntheticDicom';

const FIRST = 'segment-owner-a.mha';
const SECOND = 'segment-owner-b.mha';
const THIRD = 'segment-owner-c.mha';

type Helpers = {
  page: Page;
  volview: VolViewPage;
  utils: Utils;
  segmentation: SegmentationUtils;
  scratch: Scratch;
};

const volumeCards = (page: Page) => page.locator('.image-list-card');
const active2DView = (page: Page) =>
  page.locator(
    '.grid-item[style*="mediumseagreen"] [data-testid~="vtk-two-view"]'
  );

const showImage = async (
  { page, volview, segmentation }: Helpers,
  name: string
) => {
  await segmentation.clickImageCard(name);
  await segmentation.openAnnotationSegments();
  await volview.waitForLoadingIndicator(active2DView(page));
};

// The restored Paint tool switches the side panel to Annotations once applied.
const restorePaintSession = async (
  { page, volview, utils }: Helpers,
  savedPath: string
) => {
  await utils.openThroughDialog(savedPath);
  await volview.waitForViews();
  await expect(
    page.locator('[data-testid="module-tab-Annotations"]')
  ).toHaveAttribute('aria-selected', 'true');
};

const paint = async ({ page, volview }: Helpers) => {
  const view = active2DView(page);
  await expect(view).toBeVisible();
  await volview.paintStrokeOnView(view);
};

const expectSegments = async ({ segmentation }: Helpers, names: string[]) => {
  await expect
    .poll(segmentation.segmentNames, {
      message: `Expected segment list ${names.join(', ')}`,
    })
    .toEqual(names);
};

const openImages = async (helpers: Helpers) => {
  const { page, volview, utils, scratch } = helpers;
  utils.writeMetaImage(FIRST, { size: 32, step: 3 });
  utils.writeMetaImage(SECOND, { size: 32, step: 5 });
  await volview.open(`?urls=[tmp/${FIRST}]`);
  await volview.waitForViews();
  await utils.openThroughDialog(scratch.path(SECOND));
  await expect(volumeCards(page)).toHaveCount(2);
  await showImage(helpers, FIRST);
};

const createSourceDefinitions = async (helpers: Helpers) => {
  const { volview, segmentation } = helpers;
  await volview.activatePaint();
  await paint(helpers);
  await segmentation.openAnnotationSegments();
  await segmentation.addSegment();
  await segmentation.renameSegment('Segment 2', 'Liver');
  await segmentation.renameSegment('Segment 1', 'Tumor');
  await segmentation.selectSegment('Tumor');
  await segmentation.waitForSegmentContent('Tumor');
};

const openSparseSession = async (
  { utils, segmentation }: Helpers,
  activeView?: string
) => {
  utils.writeMetaImage(THIRD, { size: 32, step: 7 });
  const manifest = await utils.writeManifestToFile(
    {
      version: '8.0.0',
      datasets: [{ id: 'restored', dataSourceId: 1 }],
      dataSources: [{ id: 1, type: 'uri', uri: `/tmp/${THIRD}` }],
      activeView,
    },
    'segment-owner-sparse.volview.json'
  );
  await utils.openThroughDialog(manifest);
  await segmentation.openAnnotationSegments();
  await expect(segmentation.segmentImageName()).toHaveText(THIRD);
};

test.describe('Image segmentation sets', () => {
  test('keeps configured definitions independent for two DICOM series and cine imported together', async ({
    page,
    volview,
    utils,
    segmentation,
    scratch,
  }) => {
    const h = { page, volview, utils, segmentation, scratch };
    const folder = 'segment-owner-dicom-batch';
    const directory = utils.makeTempDir(folder);
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
    await volview.open(`?urls=[${resources.join(',')}]`);
    await volview.waitForViews();
    await expect(page.locator('.volume-card')).toHaveCount(3);

    const showSeries = async (name: string) => {
      await page.locator('button[data-testid="module-tab-Data"]').click();
      await utils.waitForModuleTransitions();
      const titles = page.locator('.volume-card .series-desc .text-ellipsis');
      const names = await titles.allInnerTexts();
      expect(names).toContain(name);
      await titles.nth(names.indexOf(name)).click();
      await segmentation.openAnnotationSegments();
      await expect(segmentation.segmentImageName()).toHaveText(name);
    };

    await showSeries('101');
    await expectSegments(h, ['Tumor', 'Liver']);
    await segmentation.renameSegment('Tumor', 'Lesion');
    await showSeries('202');
    await expectSegments(h, ['Tumor', 'Liver']);
    await showSeries('Synthetic cine');
    await expectSegments(h, ['Tumor', 'Liver']);
    await expect(page.locator('[data-testid~="vtk-cine-view"]')).toBeVisible();
    await showSeries('101');
    await expectSegments(h, ['Lesion', 'Liver']);
    expect(await volview.getNotificationsCount()).toEqual(0);
  });

  test('starts images empty without a config when a sparse session reuses a replaced first view', async ({
    page,
    volview,
    utils,
    segmentation,
    scratch,
  }) => {
    const h = { page, volview, utils, segmentation, scratch };
    await openImages(h);
    await segmentation.addSegment();
    await segmentation.renameSegment('Segment 1', 'Liver');
    await page
      .locator('.grid-item')
      .nth(0)
      .locator('.view-type-select .v-field')
      .click();
    await utils.overlayOption('Coronal').click();
    await expect(
      page.locator('.grid-item').nth(0).locator('.view-type-select input')
    ).toHaveValue('Coronal');

    await segmentation.dropImageOnView(SECOND, 0);
    await segmentation.openAnnotationSegments();
    await expect(segmentation.segmentImageName()).toHaveText(SECOND);
    await expectSegments(h, []);
    await volview.selectTool('mdi-cursor-default');
    await page.locator('.grid-item').nth(1).locator('canvas').click();
    await expect(segmentation.segmentImageName()).toHaveText(FIRST);
    await expectSegments(h, ['Liver']);

    await openSparseSession(h);

    await expectSegments(h, []);
    await expect(
      page.locator('.grid-item[style*="mediumseagreen"]')
    ).toBeVisible();
  });

  test('keeps a visible image selected when a sparse session names an unknown view', async ({
    page,
    volview,
    utils,
    segmentation,
    scratch,
  }) => {
    const h = { page, volview, utils, segmentation, scratch };
    await volview.open();

    await openSparseSession(h, 'missing-view');

    await expect(
      page.locator('.grid-item[style*="mediumseagreen"]')
    ).toBeVisible();
    await segmentation.addSegment();
    await expectSegments(h, ['Segment 1']);
  });

  test('adds each config to the current image without removing or renaming anything', async ({
    page,
    volview,
    utils,
    segmentation,
    scratch,
  }) => {
    const h = { page, volview, utils, segmentation, scratch };
    utils.writeMetaImage(FIRST, { size: 32 });
    await utils.writeManifestToFile(
      { segments: { Liver: { color: '#ff0000' } } },
      'segment-owner-initial.json'
    );
    await volview.open(`?urls=[tmp/${FIRST},tmp/segment-owner-initial.json]`);
    await volview.waitForViews();
    await segmentation.openAnnotationSegments();
    await expectSegments(h, ['Liver']);

    const directory = utils.makeTempDir('segment-owner-failed-import');
    writeFileSync(path.join(directory, 'broken.vti'), 'not VTI');
    writeFileSync(
      path.join(directory, 'companion.json'),
      JSON.stringify({ segments: { Tumor: { color: '#00ff00' } } })
    );
    const manifest = await utils.writeManifestToFile(
      {
        resources: [
          { url: '/tmp/segment-owner-failed-import/broken.vti' },
          { url: '/tmp/segment-owner-failed-import/companion.json' },
        ],
      },
      'segment-owner-failed-resources.json'
    );
    await utils.openThroughDialog(manifest);
    await volview.waitForNotification();
    await expectSegments(h, ['Liver', 'Tumor']);

    const standalone = await utils.writeManifestToFile(
      { segments: { Standalone: { color: '#0000ff' } } },
      'segment-owner-standalone.json'
    );
    await utils.openThroughDialog(standalone);
    await expectSegments(h, ['Liver', 'Tumor', 'Standalone']);

    await segmentation.renameSegment('Standalone', 'Mine');
    await utils.openThroughDialog(standalone);
    await expectSegments(h, ['Liver', 'Tumor', 'Mine', 'Standalone']);
  });

  test('gives every newly shown image the config segments in any order', async ({
    page,
    volview,
    utils,
    segmentation,
    scratch,
  }) => {
    const h = { page, volview, utils, segmentation, scratch };
    utils.writeMetaImage(FIRST, { size: 32, step: 3 });
    utils.writeMetaImage(SECOND, { size: 32, step: 5 });
    await utils.writeManifestToFile(
      { segments: { Tumor: {}, Liver: {} } },
      'segment-owner-order-config.json'
    );
    await volview.open(
      `?urls=[tmp/${FIRST},tmp/${SECOND},tmp/segment-owner-order-config.json]`
    );
    await volview.waitForViews();
    await showImage(h, FIRST);
    await expectSegments(h, ['Tumor', 'Liver']);
    await segmentation.addSegment();
    await segmentation.renameSegment('Segment 1', 'Node');
    await expectSegments(h, ['Tumor', 'Liver', 'Node']);

    await showImage(h, SECOND);
    await expectSegments(h, ['Tumor', 'Liver']);
  });

  test('copies definitions on request and keeps edits and deletion on their image', async ({
    page,
    volview,
    utils,
    segmentation,
    scratch,
  }) => {
    const h = { page, volview, utils, segmentation, scratch };
    await openImages(h);
    await createSourceDefinitions(h);
    const originalColor = await segmentation.segmentColor('Tumor');

    await showImage(h, SECOND);
    await expectSegments(h, []);
    await segmentation.createSegmentRow().focus();
    await page.keyboard.press('Tab');
    await expect(segmentation.copySegmentsRow()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(segmentation.copySource(FIRST)).toBeVisible();
    await expect(segmentation.copySource(FIRST)).toContainText('2 segments');
    await page.keyboard.press('ArrowDown');
    await expect(segmentation.copySource(FIRST)).toBeFocused();
    await page.keyboard.press('Enter');
    await expectSegments(h, ['Tumor', 'Liver']);
    expect(await segmentation.selectedSegmentName()).toEqual('Tumor');
    expect(await segmentation.segmentColor('Tumor')).toEqual(originalColor);
    await expect(
      (await segmentation.segmentRow('Tumor')).locator(
        '[data-testid="reveal-segment-button"]'
      )
    ).toBeDisabled();
    await expect(volview.saveSegmentsButtons.first()).toBeDisabled();

    await segmentation.openCopySegmentsMenu();
    const copied = segmentation.copySource(FIRST);
    await expect(copied).toHaveClass(/\bv-list-item--disabled\b/);
    await utils.moveToElement(copied);
    const reason = await segmentation.tooltipOf(copied.locator('..'));
    await expect(reason).toHaveText('Every segment is already on this image');
    // The active class leaves on close, so follow the element itself out.
    const copiedElement = await copied.elementHandle();
    await page.keyboard.press('Escape');
    await copiedElement?.waitForElementState('hidden');

    await segmentation.renameSegment('Tumor', 'Lesion');
    await segmentation.recolorSegment('Lesion', 64);
    const secondColor = await segmentation.segmentColor('Lesion');
    expect(secondColor).not.toEqual(originalColor);
    await paint(h);
    await segmentation.waitForSegmentContent('Lesion');
    await segmentation.lockSegment('Liver');
    await (await segmentation.segmentRow('Liver'))
      .locator('button[aria-label="Hide Liver"]')
      .click();

    await showImage(h, FIRST);
    await expectSegments(h, ['Tumor', 'Liver']);
    expect(await segmentation.selectedSegmentName()).toEqual('Tumor');
    expect(await segmentation.segmentColor('Tumor')).toEqual(originalColor);
    await segmentation.waitForSegmentContent('Tumor');
    await expect(
      (await segmentation.segmentRow('Liver')).locator(
        'button[aria-label="Lock Liver"]'
      )
    ).toBeAttached();
    await expect(
      (await segmentation.segmentRow('Liver')).locator(
        'button[aria-label="Hide Liver"]'
      )
    ).toBeAttached();

    await showImage(h, SECOND);
    await expectSegments(h, ['Lesion', 'Liver']);
    expect(await segmentation.segmentColor('Lesion')).toEqual(secondColor);
    await segmentation.deleteSegment('Lesion');
    await showImage(h, FIRST);
    await expectSegments(h, ['Tumor', 'Liver']);
    await segmentation.waitForSegmentContent('Tumor');
    await expect(volview.saveSegmentsButtons.first()).toBeEnabled();
  });

  test('keeps a same-named segment when copying', async ({
    page,
    volview,
    utils,
    segmentation,
    scratch,
  }) => {
    const h = { page, volview, utils, segmentation, scratch };
    await openImages(h);
    await createSourceDefinitions(h);
    const firstLiver = await segmentation.segmentColor('Liver');
    await showImage(h, SECOND);
    await segmentation.addSegment();
    await segmentation.renameSegment('Segment 1', 'Liver');
    await segmentation.recolorSegment('Liver', 64);
    const ownLiver = await segmentation.segmentColor('Liver');
    expect(ownLiver).not.toEqual(firstLiver);

    await segmentation.copySegmentsFrom(FIRST);

    await expectSegments(h, ['Liver', 'Tumor']);
    expect(await segmentation.segmentColor('Liver')).toEqual(ownLiver);
  });

  test('disables copying while no other image has segments', async ({
    volview,
    utils,
    segmentation,
  }) => {
    utils.writeMetaImage(FIRST, { size: 32, step: 3 });
    await volview.open(`?urls=[tmp/${FIRST}]`);
    await volview.waitForViews();
    await segmentation.openAnnotationSegments();
    await segmentation.addSegment();

    const row = segmentation.copySegmentsRow();
    await expect(row).toBeDisabled();
    await utils.moveToElement(row);
    const reason = await segmentation.tooltipOf(row.locator('..'));
    await expect(reason).toHaveText('No other image has segments yet');
  });

  test('keeps a never-viewed image empty after restore and copies onto it', async ({
    page,
    volview,
    utils,
    segmentation,
    scratch,
  }) => {
    const h = { page, volview, utils, segmentation, scratch };
    await openImages(h);
    await createSourceDefinitions(h);

    const filename = await volview.saveSession();
    const savedPath = scratch.path(filename);
    await volview.open();
    await restorePaintSession(h, savedPath);
    await showImage(h, SECOND);
    await expectSegments(h, []);

    await segmentation.copySegmentsFrom(FIRST);

    await expectSegments(h, ['Tumor', 'Liver']);
    await showImage(h, FIRST);
    await segmentation.waitForSegmentContent('Tumor');
  });

  test('preserves a deliberately empty set through switching and restore until a config fills it', async ({
    page,
    volview,
    utils,
    segmentation,
    scratch,
  }) => {
    const h = { page, volview, utils, segmentation, scratch };
    await openImages(h);
    await createSourceDefinitions(h);
    const competingDefaults = await utils.writeManifestToFile(
      { segments: { Tumor: {}, Liver: {} } },
      'segment-owner-competing-defaults.json'
    );
    await utils.openThroughDialog(competingDefaults);
    await expectSegments(h, ['Tumor', 'Liver']);
    await showImage(h, SECOND);
    await expectSegments(h, ['Tumor', 'Liver']);
    await segmentation.deleteSegment('Tumor');
    await segmentation.deleteSegment('Liver');
    await expectSegments(h, []);
    await showImage(h, FIRST);
    await segmentation.waitForSegmentContent('Tumor');
    await showImage(h, SECOND);
    await expectSegments(h, []);

    await showImage(h, FIRST);
    await expectSegments(h, ['Tumor', 'Liver']);
    const filename = await volview.saveSession();
    const savedPath = scratch.path(filename);
    await volview.open();
    await restorePaintSession(h, savedPath);
    await showImage(h, SECOND);
    await expectSegments(h, []);
    await showImage(h, FIRST);
    await expectSegments(h, ['Tumor', 'Liver']);
    await segmentation.waitForSegmentContent('Tumor');
    expect(await volview.getNotificationsCount()).toEqual(0);

    await volview.open();
    await utils.openThroughDialog(competingDefaults);
    await restorePaintSession(h, savedPath);
    await showImage(h, SECOND);
    await expectSegments(h, ['Tumor', 'Liver']);
    await showImage(h, FIRST);
    await expectSegments(h, ['Tumor', 'Liver']);
    await segmentation.waitForSegmentContent('Tumor');
  });
});
