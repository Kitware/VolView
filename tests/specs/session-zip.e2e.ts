import * as path from 'path';
import * as fs from 'fs';
import JSZip from 'jszip';
import type { ChainablePromiseElement } from 'webdriverio';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';

const SESSION_SAVE_TIMEOUT = 40000;
const SLOW_INTERACTION_TIMEOUT = 10000;

// from https://stackoverflow.com/a/47764403
function waitForFileExists(filePath: string, timeout: number) {
  return new Promise<void>((resolve, reject) => {
    let watcher: fs.FSWatcher;

    const onTimeout = () => {
      watcher.close();
      reject(
        new Error(
          `File ${filePath} did not exists and was not created during the timeout of ${timeout} ms}`
        )
      );
    };

    const timerId = setTimeout(onTimeout, timeout);

    // watch if file newly created
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath);
    watcher = fs.watch(dir, (eventType: any, filename: string | null) => {
      if (eventType === 'rename' && filename === basename) {
        clearTimeout(timerId);
        watcher.close();
        resolve();
      }
    });

    // check if file already exists
    fs.access(filePath, fs.constants.R_OK, (err) => {
      if (!err) {
        clearTimeout(timerId);
        watcher.close();
        resolve();
      }
    });
  });
}

const saveSession = async () => {
  const sessionFileName = await volViewPage.saveSession();
  const downloadedPath = path.join(TEMP_DIR, sessionFileName);
  await waitForFileExists(downloadedPath, SESSION_SAVE_TIMEOUT);
  return sessionFileName;
};

const parseManifest = async (sessionFileName: string) => {
  const session = fs.readFileSync(path.join(TEMP_DIR, sessionFileName));
  const zip = await JSZip.loadAsync(session);
  const manifestFile = await zip.files['manifest.json'].async('string');
  return JSON.parse(manifestFile);
};

const saveGetManifest = async () => {
  const session = await saveSession();
  await browser.pause(1000); // wait for writing to finish before unzipping?
  const manifest = await parseManifest(session);
  return { session, manifest };
};

const getRectangleCount = async (view: ChainablePromiseElement) => {
  const rectangles = await view.$$(
    'svg[data-testid="rectangle-tool-container"] > g'
  );
  return rectangles.length;
};

const waitForRectangleCount = async (
  view: ChainablePromiseElement,
  countTarget: number
) => {
  await browser.waitUntil(
    async function newRectangleExist() {
      const toolCount = await getRectangleCount(view);
      return toolCount >= countTarget;
    },
    {
      timeoutMsg: `expected ${countTarget} rectangles to be drawn in ${SLOW_INTERACTION_TIMEOUT} ms}`,
      timeout: SLOW_INTERACTION_TIMEOUT,
    }
  );
};

const clickTwice = async (view: ChainablePromiseElement) => {
  await view.waitForClickable();
  const origin = view;
  await browser
    .action('pointer')
    .move({ duration: 10, origin, x: 0, y: 0 })
    .down({ button: 0 }) // left button
    .up({ button: 0 })
    .pause(10)
    .move({ duration: 10, origin, x: 30, y: 30 })
    .pause(10)
    .down({ button: 0 }) // left button
    .pause(10)
    .up({ button: 0 })
    .perform();
};

const annotate = async () => {
  await volViewPage.open();
  await volViewPage.downloadProstateSample();
  await volViewPage.waitForViews();

  // draw rectangle
  await volViewPage.activateRectangle();
  const view = await volViewPage.viewTwoContainer;
  await waitForRectangleCount(view, 1); // wait for placing tool
  await clickTwice(view);
  await waitForRectangleCount(view, 2); // wait for drawn tool
};

describe('VolView config and deserialization', () => {
  it('config.json files should override label props of existing tool', async () => {
    await annotate();

    const newColor = 'green';

    const { manifest, session } = await saveGetManifest();

    expect(manifest.tools.rectangles.tools.length).toEqual(1);
    expect(manifest.tools.rectangles.tools?.[0].color).not.toEqual(newColor);

    const config = {
      labels: {
        defaultLabels: {
          lesion: {
            color: newColor,
          },
        },
      },
    };

    // write object as json to file
    const configFileName = 'config.json';
    const configPath = path.join(TEMP_DIR, configFileName);
    await fs.promises.writeFile(configPath, JSON.stringify(config));
    cleanuptotal.addCleanup(async () => {
      fs.unlinkSync(configPath);
    });

    const sessionZipAndConfig = `?urls=[tmp/${configFileName},tmp/${session}]`;
    await volViewPage.open(sessionZipAndConfig);

    await volViewPage.waitForViews();

    const { manifest: changedManifest } = await saveGetManifest();
    expect(changedManifest.tools.rectangles.tools?.[0].color).toEqual(newColor);
  });

  it('edited default label is serialized and deserialized', async () => {
    await annotate();

    const editedStrokeWidth = 9;

    const buttons = await volViewPage.editLabelButtons;
    await buttons[2].click();
    const input = await volViewPage.labelStrokeWidthInput;
    await setValueVueInput(input, editedStrokeWidth.toString());

    const done = await volViewPage.editLabelModalDoneButton;
    await done.click();

    const { session } = await saveGetManifest();

    const sessionZip = `?urls=[tmp/${session}]`;
    await volViewPage.open(sessionZip);
    await volViewPage.waitForViews();

    const { manifest: changedManifest } = await saveGetManifest();
    expect(changedManifest.tools.rectangles.tools?.[0].strokeWidth).toEqual(
      editedStrokeWidth
    );
  });
});
