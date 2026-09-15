import * as path from 'path';
import * as fs from 'fs';
import JSZip from 'jszip';
import {
  MINIMAL_501_SESSION,
  PROSTATEX_DATASET,
  PROSTATE_610_LABELMAP_MANIFEST,
  PROSTATE_SEGMENT_GROUP,
} from './configTestUtils';
import {
  downloadFile,
  openVolViewPage,
  SESSION_SAVE_TIMEOUT,
  waitForFileExists,
  writeManifestToFile,
} from './utils';
import { volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import {
  openAnnotationSegments,
  openSegmentShapes,
  segmentColor,
  segmentNames,
  segmentRow,
  waitForNamedSegments,
  waitForSegmentContent,
} from './segmentationTestUtils';

// The 5.0.1 fixture's rectangle carries this name.
const RECTANGLE_SEGMENT_NAME = 'Label 1';

const waitForElementCount = async (selector: string, minCount = 1) => {
  await browser.waitUntil(async () => {
    const count = await browser.execute(
      (sel) => document.querySelectorAll(sel).length,
      selector
    );
    return count >= minCount;
  });
};

const saveSession = async () => {
  const sessionFileName = await volViewPage.saveSession();
  const downloadedPath = path.join(TEMP_DIR, sessionFileName);
  await waitForFileExists(downloadedPath, SESSION_SAVE_TIMEOUT);
  return sessionFileName;
};

const parseSession = async (sessionFileName: string) => {
  const session = fs.readFileSync(path.join(TEMP_DIR, sessionFileName));
  const zip = await JSZip.loadAsync(session);
  const manifestFile = await zip.files['manifest.json'].async('string');
  return {
    zip,
    manifest: JSON.parse(manifestFile),
  };
};

const saveAndParseManifest = async () => {
  const session = await saveSession();
  let zip: JSZip | undefined;
  let manifest: Record<string, unknown> = {};
  await browser.waitUntil(async () => {
    try {
      const parsed = await parseSession(session);
      zip = parsed.zip;
      manifest = parsed.manifest;
      return manifest.version !== undefined;
    } catch {
      return false;
    }
  });
  return { session, zip, manifest };
};

const loadSession = async () => {
  await downloadFile(MINIMAL_501_SESSION.url, MINIMAL_501_SESSION.name);
  const urlParams = `?urls=[tmp/${MINIMAL_501_SESSION.name}]`;
  await volViewPage.open(urlParams);
  await volViewPage.waitForViews();
};

const openProstateLabelmap = async (fileName: string) => {
  await openVolViewPage(fileName);
  await openAnnotationSegments();
  await waitForNamedSegments();
  await waitForSegmentContent('Right hip');
};

describe('Session state lifecycle', () => {
  it('migrates 5.0.1 session with rectangle, polygons, and labelmap', async () => {
    await loadSession();

    const notifications = await volViewPage.getNotificationsCount();
    expect(notifications).toEqual(0);

    await openSegmentShapes();

    await waitForElementCount(
      '[data-testid="segment-shape-row"] i.mdi-vector-square'
    );
    await waitForElementCount(
      '[data-testid="segment-shape-row"] i.mdi-pentagon-outline'
    );

    await openAnnotationSegments();
    await waitForNamedSegments();
  });

  it('edited type strokeWidth persists through save/load cycle', async () => {
    await loadSession();

    const editedStrokeWidth = 5;

    // Rectangle draws with the entry selected in the Segments list, which is
    // where the session's rectangle segment shows up.
    await volViewPage.activateRectangle();
    await openAnnotationSegments();
    await waitForNamedSegments();

    // The list shows every segment in the registry, so pick the one the
    // session's rectangle actually carries rather than the first row.
    const row = await segmentRow(RECTANGLE_SEGMENT_NAME);
    await row.waitForDisplayed();
    const editButton = await row.$('button[data-testid="edit-segment-button"]');
    await editButton.click();

    const slider = await volViewPage.segmentStrokeWidthSlider;
    await slider.waitForClickable();
    await slider.click();
    await browser.keys('End');
    await expect(slider).toHaveAttribute(
      'aria-valuenow',
      editedStrokeWidth.toString()
    );

    const done = await volViewPage.editLabelModalDoneButton;
    await done.click();

    const { session } = await saveAndParseManifest();

    const sessionZip = `?urls=[tmp/${session}]`;
    await volViewPage.open(sessionZip);
    await volViewPage.waitForViews();

    const { manifest: reloadedManifest } = await saveAndParseManifest();
    // Stroke width belongs to the type the rectangle names, not to the shape.
    const tools = reloadedManifest.tools as {
      rectangles: { tools: Array<{ segmentId: string }> };
    };
    const segments = reloadedManifest.segments as Array<{
      id: string;
      strokeWidth?: number;
    }>;
    const carried = segments.find(
      (segment) => segment.id === tools.rectangles.tools[0].segmentId
    );
    expect(carried?.strokeWidth).toEqual(editedStrokeWidth);
  });

  it('sanitizes stored labelmap names when saving them into the session zip', async () => {
    await downloadFile(PROSTATEX_DATASET.url, PROSTATEX_DATASET.name);
    await downloadFile(PROSTATE_SEGMENT_GROUP.url, PROSTATE_SEGMENT_GROUP.name);

    // The panel is one flat list per image with no group left to name, so a
    // filesystem-hostile name now reaches the app through the manifest.
    const storedName = 'Liver: left/right*?';
    const sanitizedFilePath = 'segmentations/Liver left right.vti';
    const source = PROSTATE_610_LABELMAP_MANIFEST.labelMaps[0];
    const fileName = `hostile-labelmap-name-${Date.now()}.volview.json`;
    await writeManifestToFile(
      {
        ...PROSTATE_610_LABELMAP_MANIFEST,
        labelMaps: [
          { ...source, metadata: { ...source.metadata, name: storedName } },
        ],
      },
      fileName
    );
    await openProstateLabelmap(fileName);

    const { manifest, zip } = await saveAndParseManifest();
    if (!zip) {
      throw new Error('Expected saved session zip to be available');
    }
    // A save writes one archive entry per mask, named on the mask's own
    // labelmap binding.
    const segmentations = manifest.segmentations as Array<{
      masks: Array<{
        representations: { labelmap?: { path: string; name: string } };
      }>;
    }>;
    const bindings = segmentations.flatMap((segmentation) =>
      segmentation.masks.flatMap((mask) => mask.representations.labelmap ?? [])
    );

    expect(bindings.length).toBeGreaterThan(0);
    // The stored name survives; only the path it becomes is sanitized.
    expect(bindings.every((binding) => binding.name === storedName)).toBe(true);
    expect(bindings[0].path).toEqual(sanitizedFilePath);
    expect(Object.keys(zip.files)).toContain(sanitizedFilePath);
  });

  it('re-saves a migrated legacy labelmap with its segments intact', async () => {
    await downloadFile(PROSTATEX_DATASET.url, PROSTATEX_DATASET.name);
    await downloadFile(PROSTATE_SEGMENT_GROUP.url, PROSTATE_SEGMENT_GROUP.name);

    const fileName = `legacy-labelmap-${Date.now()}.volview.json`;
    await writeManifestToFile(PROSTATE_610_LABELMAP_MANIFEST, fileName);
    await openProstateLabelmap(fileName);

    // The 6.1.0 labelMaps entry names this segment and colors it red.
    expect(await segmentNames()).toEqual(['Right hip']);
    const segmentColorBefore = await segmentColor('Right hip');

    const { session, manifest } = await saveAndParseManifest();
    expect(manifest.version).toEqual('7.0.0');

    await volViewPage.open(`?urls=[tmp/${session}]`);
    await volViewPage.waitForViews();
    expect(await volViewPage.getNotificationsCount()).toEqual(0);

    await openAnnotationSegments();
    await waitForNamedSegments();
    expect(await segmentNames()).toEqual(['Right hip']);
    await waitForSegmentContent('Right hip');
    expect(await segmentColor('Right hip')).toEqual(segmentColorBefore);
  });
});
