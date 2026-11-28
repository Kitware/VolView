import * as fs from 'node:fs';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { MINIMAL_501_SESSION } from '../datasets';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import { PROSTATE_610_LABELMAP_MANIFEST } from './configTestUtils';
import type { Utils } from './utils';
import type { SegmentationUtils } from './segmentationTestUtils';

// The 5.0.1 fixture's rectangle carries this name.
const RECTANGLE_SEGMENT_NAME = 'Label 1';

const waitForElementCount = (page: Page, selector: string, minCount = 1) =>
  expect
    .poll(() => page.locator(selector).count())
    .toBeGreaterThanOrEqual(minCount);

const saveAndParseManifest = async (volview: VolViewPage, scratch: Scratch) => {
  const session = await volview.saveSession();
  const zip = await JSZip.loadAsync(fs.readFileSync(scratch.path(session)));
  const manifestFile = await zip.files['manifest.json'].async('string');
  const manifest: Record<string, unknown> = JSON.parse(manifestFile);
  return { session, zip, manifest };
};

const loadSession = async (volview: VolViewPage) => {
  await volview.open(`?urls=[tmp/${MINIMAL_501_SESSION.name}]`);
  await volview.waitForViews();
};

const openProstateLabelmap = async (
  { utils, segmentation }: { utils: Utils; segmentation: SegmentationUtils },
  fileName: string,
  segmentName = 'Right hip'
) => {
  await utils.openVolViewPage(fileName);
  await segmentation.openAnnotationSegments();
  await segmentation.waitForNamedSegments();
  await segmentation.waitForSegmentContent(segmentName);
};

test.describe('Session state lifecycle', () => {
  test('migrates 5.0.1 session with rectangle, polygons, and labelmap', async ({
    page,
    volview,
    segmentation,
  }) => {
    await loadSession(volview);

    const notifications = await volview.getNotificationsCount();
    expect(notifications).toEqual(0);

    await segmentation.openSegmentShapes();

    await waitForElementCount(
      page,
      '[data-testid="segment-shape-row"] i.mdi-vector-square'
    );
    await waitForElementCount(
      page,
      '[data-testid="segment-shape-row"] i.mdi-pentagon-outline'
    );

    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
  });

  test('edited type strokeWidth persists through save/load cycle', async ({
    page,
    scratch,
    volview,
    segmentation,
  }) => {
    await loadSession(volview);

    const editedStrokeWidth = 5;

    // Rectangle draws with the entry selected in the Segments list, which is
    // where the session's rectangle segment shows up.
    await volview.activateRectangle();
    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();

    // Pick the rectangle's segment from the current image's list.
    const row = await segmentation.segmentRow(RECTANGLE_SEGMENT_NAME);
    await expect(row).toBeVisible();
    await row.locator('button[data-testid="edit-segment-button"]').click();

    const slider = volview.segmentStrokeWidthSlider;
    await slider.click();
    await page.keyboard.press('End');
    await expect(slider).toHaveAttribute(
      'aria-valuenow',
      editedStrokeWidth.toString()
    );

    await volview.editLabelModalDoneButton.click();

    const { session } = await saveAndParseManifest(volview, scratch);

    await volview.open(`?urls=[tmp/${session}]`);
    await volview.waitForViews();

    const { manifest: reloadedManifest } = await saveAndParseManifest(
      volview,
      scratch
    );
    // Stroke width belongs to the type the rectangle names, not to the shape.
    const tools = reloadedManifest.tools as {
      rectangles: { tools: Array<{ segmentId: string }> };
    };
    const imageSegments = reloadedManifest.imageSegments as Array<{
      segments: Array<{ id: string; strokeWidth?: number }>;
    }>;
    const carried = imageSegments
      .flatMap(({ segments }) => segments)
      .find((segment) => segment.id === tools.rectangles.tools[0].segmentId);
    expect(carried?.strokeWidth).toEqual(editedStrokeWidth);
  });

  test('names each saved mask entry after its image and segment, sanitized', async ({
    scratch,
    volview,
    utils,
    segmentation,
  }) => {
    const storedName = 'Liver: left/right*?';
    const sanitizedFilePath = 'segmentations/t2_tse_tra - Liver left right.vti';
    const source = PROSTATE_610_LABELMAP_MANIFEST.labelMaps[0];
    const segment = source.metadata.segments.byValue['78'];
    const fileName = `hostile-segment-name-${Date.now()}.volview.json`;
    await utils.writeManifestToFile(
      {
        ...PROSTATE_610_LABELMAP_MANIFEST,
        labelMaps: [
          {
            ...source,
            metadata: {
              ...source.metadata,
              segments: {
                ...source.metadata.segments,
                byValue: { '78': { ...segment, name: storedName } },
              },
            },
          },
        ],
      },
      fileName
    );
    await openProstateLabelmap({ utils, segmentation }, fileName, storedName);

    const { manifest, zip } = await saveAndParseManifest(volview, scratch);
    const imageSegments = manifest.imageSegments as Array<{
      segments: Array<{ name: string; labelmap?: { path: string } }>;
    }>;
    const savedPath = imageSegments
      .flatMap(({ segments }) => segments)
      .find(({ name }) => name === storedName)?.labelmap?.path;

    expect(savedPath).toEqual(sanitizedFilePath);
    expect(Object.keys(zip.files)).toContain(sanitizedFilePath);
  });

  test('re-saves a migrated legacy labelmap with its segments intact', async ({
    scratch,
    volview,
    utils,
    segmentation,
  }) => {
    const fileName = `legacy-labelmap-${Date.now()}.volview.json`;
    await utils.writeManifestToFile(PROSTATE_610_LABELMAP_MANIFEST, fileName);
    await openProstateLabelmap({ utils, segmentation }, fileName);

    // The 6.1.0 labelMaps entry names this segment and colors it red. The
    // labelmap's other values restore under default names.
    const namesBefore = await segmentation.segmentNames();
    expect(namesBefore[0]).toEqual('Right hip');
    expect(namesBefore.length).toBeGreaterThan(1);
    const segmentColorBefore = await segmentation.segmentColor('Right hip');

    const { session, manifest } = await saveAndParseManifest(volview, scratch);
    expect(manifest.version).toEqual('8.0.0');

    await volview.open(`?urls=[tmp/${session}]`);
    await volview.waitForViews();
    expect(await volview.getNotificationsCount()).toEqual(0);

    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
    await segmentation.waitForSegmentContent('Right hip');
    expect(await segmentation.segmentNames()).toEqual(namesBefore);
    expect(await segmentation.segmentColor('Right hip')).toEqual(
      segmentColorBefore
    );
  });
});
