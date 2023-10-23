import * as path from 'path';
import * as fs from 'fs';
import JSZip from 'jszip';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { DOWNLOAD_TIMEOUT, TEMP_DIR } from '../../wdio.shared.conf';

// from https://stackoverflow.com/a/47764403
function waitForFileExists(filePath: string, timeout: number) {
  return new Promise<void>((resolve, reject) => {
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath);
    let timerId = undefined as NodeJS.Timeout | undefined;
    const watcher = fs.watch(dir, (eventType: any, filename: string | null) => {
      if (eventType === 'rename' && filename === basename) {
        clearTimeout(timerId);
        watcher.close();
        resolve();
      }
    });

    const onTimeout = () => {
      watcher.close();
      reject(
        new Error('File did not exists and was not created during the timeout.')
      );
    };

    timerId = setTimeout(onTimeout, timeout);

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
  await waitForFileExists(downloadedPath, 5000);
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
  const manifest = await parseManifest(session);
  return { session, manifest };
};

const annotate = async () => {
  await volViewPage.open();
  await volViewPage.downloadProstateSample();
  await volViewPage.waitForViews(DOWNLOAD_TIMEOUT);

  // draw rectangle
  await volViewPage.activateRectangle();
  await volViewPage.clickTwiceInTwoView();
};

describe('VolView config and deserialization', () => {
  it('config.json files should override label props of existing tool', async () => {
    await annotate();

    const newColor = 'green';

    const { manifest, session } = await saveGetManifest();
    expect(manifest.tools.rectangles.tools?.[0].color).not.toEqual('green');

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

    await volViewPage.waitForViews(DOWNLOAD_TIMEOUT);
    // await volViewPage.activateRectangle(); // wait for config to load (waitForViews did not work)

    const { manifest: changedManifest } = await saveGetManifest();
    expect(changedManifest.tools.rectangles.tools?.[0].color).toEqual(newColor);
  });

  it('edited default label is serialized and deserialized', async () => {
    await annotate();

    const buttons = await volViewPage.editLabelButtons;
    await buttons[2].click();
    const editedStrokeWidth = 9;

    const input = await volViewPage.labelStrokeWidthInput;
    await setValueVueInput(input, editedStrokeWidth.toString());

    const done = await volViewPage.editLabelModalDoneButton;
    await done.click();

    const { session } = await saveGetManifest();

    const sessionZip = `?urls=[tmp/${session}]`;
    await volViewPage.open(sessionZip);
    await volViewPage.waitForViews(DOWNLOAD_TIMEOUT);

    const { manifest: changedManifest } = await saveGetManifest();
    expect(changedManifest.tools.rectangles.tools?.[0].strokeWidth).toEqual(
      editedStrokeWidth
    );
  });
});
