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
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import {
  openAnnotationSegments,
  segmentColor,
  segmentNames,
  showFirstSegmentGroup,
} from './segmentationTestUtils';

// The 5.0.1 fixture's rectangle carries this label.
const RECTANGLE_LABEL_NAME = 'Label 1';

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

describe('Session state lifecycle', () => {
  it('migrates 5.0.1 session with rectangle, polygons, and labelmap', async () => {
    await loadSession();

    const notifications = await volViewPage.getNotificationsCount();
    expect(notifications).toEqual(0);

    const annotationsTab = await $(
      'button[data-testid="module-tab-Annotations"]'
    );
    await annotationsTab.click();

    const measurementsTab = await $('button.v-tab*=Measurements');
    await measurementsTab.waitForClickable();
    await measurementsTab.click();

    await waitForElementCount('.v-list-item i.mdi-vector-square.tool-icon');
    await waitForElementCount('.v-list-item i.mdi-pentagon-outline.tool-icon');

    await openAnnotationSegments();
    await showFirstSegmentGroup();
  });

  it('edited label strokeWidth persists through save/load cycle', async () => {
    await loadSession();

    const editedStrokeWidth = 9;

    // Activate rectangle tool to show RectangleControls with LabelControls
    await volViewPage.activateRectangle();

    const annotationsTab = await $(
      'button[data-testid="module-tab-Annotations"]'
    );
    await annotationsTab.click();

    await waitForElementCount('button[data-testid="edit-label-button"]');

    // The list shows every segment on the image, so pick the one the session's
    // rectangle actually carries rather than the first chip.
    const labelChip = await $(`.v-chip*=${RECTANGLE_LABEL_NAME}`);
    await labelChip.waitForDisplayed();
    const editButton = await labelChip.$(
      'button[data-testid="edit-label-button"]'
    );
    await editButton.click();

    const input = await volViewPage.labelStrokeWidthInput;
    await setValueVueInput(input, editedStrokeWidth.toString());

    const done = await volViewPage.editLabelModalDoneButton;
    await done.click();

    const { session } = await saveAndParseManifest();

    const sessionZip = `?urls=[tmp/${session}]`;
    await volViewPage.open(sessionZip);
    await volViewPage.waitForViews();

    const { manifest: reloadedManifest } = await saveAndParseManifest();
    const tools = reloadedManifest.tools as {
      rectangles: { tools: Array<{ strokeWidth: number }> };
    };
    expect(tools.rectangles.tools[0].strokeWidth).toEqual(editedStrokeWidth);
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
    await openVolViewPage(fileName);

    const { manifest, zip } = await saveAndParseManifest();
    if (!zip) {
      throw new Error('Expected saved session zip to be available');
    }
    const artifacts = manifest.segmentationArtifacts as Array<{
      path: string;
      name: string;
    }>;

    expect(artifacts.length).toEqual(1);
    expect(artifacts[0].name).toEqual(storedName);
    expect(artifacts[0].path).toEqual(sanitizedFilePath);
    expect(Object.keys(zip.files)).toContain(sanitizedFilePath);
  });

  it('re-saves a migrated legacy labelmap with its segments intact', async () => {
    await downloadFile(PROSTATEX_DATASET.url, PROSTATEX_DATASET.name);
    await downloadFile(PROSTATE_SEGMENT_GROUP.url, PROSTATE_SEGMENT_GROUP.name);

    const fileName = `legacy-labelmap-${Date.now()}.volview.json`;
    await writeManifestToFile(PROSTATE_610_LABELMAP_MANIFEST, fileName);
    await openVolViewPage(fileName);

    // The 6.1.0 labelMaps entry names this segment and colors it red.
    await openAnnotationSegments();
    await showFirstSegmentGroup();
    expect(await segmentNames()).toEqual(['Prostate']);
    const prostateColor = await segmentColor('Prostate');

    const { session, manifest } = await saveAndParseManifest();
    expect(manifest.version).toEqual('7.1.0');

    await volViewPage.open(`?urls=[tmp/${session}]`);
    await volViewPage.waitForViews();
    expect(await volViewPage.getNotificationsCount()).toEqual(0);

    await openAnnotationSegments();
    await showFirstSegmentGroup();
    expect(await segmentNames()).toEqual(['Prostate']);
    expect(await segmentColor('Prostate')).toEqual(prostateColor);
  });
});
