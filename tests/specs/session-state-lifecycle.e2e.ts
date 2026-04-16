import * as path from 'path';
import * as fs from 'fs';
import JSZip from 'jszip';
import { MINIMAL_501_SESSION, PROSTATEX_DATASET } from './configTestUtils';
import { downloadFile, openUrls, waitForFileExists } from './utils';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';

const SESSION_SAVE_TIMEOUT = 40000;

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

    await browser.waitUntil(async () => {
      const rectangleEntries = await $$(
        '.v-list-item i.mdi-vector-square.tool-icon'
      );
      return (await rectangleEntries.length) >= 1;
    });

    await browser.waitUntil(async () => {
      const polygonEntries = await $$(
        '.v-list-item i.mdi-pentagon-outline.tool-icon'
      );
      return (await polygonEntries.length) >= 1;
    });

    const segmentGroupsTab = await $('button.v-tab*=Segment Groups');
    await segmentGroupsTab.waitForClickable();
    await segmentGroupsTab.click();

    await browser.waitUntil(async () => {
      const segmentGroups = await $$('.segment-group-list .v-list-item');
      return (await segmentGroups.length) >= 1;
    });
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

    await browser.waitUntil(async () => {
      const buttons = await volViewPage.editLabelButtons;
      return (await buttons.length) >= 1;
    });

    const buttons = await volViewPage.editLabelButtons;
    await buttons[0].click();

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

  it('sanitizes segment group names when saving labelmaps into the session zip', async () => {
    await openUrls([PROSTATEX_DATASET]);

    const segmentGroupName = 'Liver: left/right*?';
    const sanitizedFilePath = 'segmentations/Liver left right.vti';

    await volViewPage.createSegmentGroup(segmentGroupName);

    const { manifest, zip } = await saveAndParseManifest();
    if (!zip) {
      throw new Error('Expected saved session zip to be available');
    }
    const segmentGroups = manifest.segmentGroups as Array<{
      path: string;
      metadata: { name: string };
    }>;

    expect(segmentGroups.length).toEqual(1);
    expect(segmentGroups[0].metadata.name).toEqual(segmentGroupName);
    expect(segmentGroups[0].path).toEqual(sanitizedFilePath);
    expect(Object.keys(zip.files)).toContain(sanitizedFilePath);
  });
});
