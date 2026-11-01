import fs from 'node:fs';
import { useReferenceLines } from './referenceLinesTestUtils';
import path from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { syntheticScalars } from '../fixtures/oct/dicom';
import reference from '../fixtures/oct/reference.json';
import { createNrrdVolume, syntheticMask } from '../fixtures/oct/volumes';
import { volViewPage } from '../pageobjects/volview.page';
import {
  enFaceAppearance,
  canvasAppearance,
  expectEnFaceProjectionSettings,
  expectProjectionTransform,
  dragContrast,
  projectionTransform,
  setSlabRange,
  waitForEnFaceReady,
  CANVAS,
  VIEWER,
  attachAndSelectMask,
  openEnFaceProjection,
  openEnFaceControls,
  selectSetting,
} from './octTestUtils';
import {
  makeTempDir,
  openThroughDialog,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  writeManifestToFile,
} from './utils';

const STEM = 'projection-camera';
const SOURCE_NAME = 'camera-source.nrrd';
const MASK_NAME = 'camera-mask.nrrd';
const SEGMENT_NAME = 'Alternative synthetic band';

type MaskGateWindow = Window & {
  maskRestoreGate: { armed: boolean; entered: boolean; release?: () => void };
};

async function installMaskDecodeGate() {
  await browser.addInitScript(() => {
    const gate: MaskGateWindow['maskRestoreGate'] = {
      armed: false,
      entered: false,
    };
    (window as unknown as MaskGateWindow).maskRestoreGate = gate;
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        if (String(args[0]).includes('async.reader.worker')) {
          worker.addEventListener('message', (event) => {
            if (!gate.armed) return;
            gate.armed = false;
            gate.entered = true;
            event.stopImmediatePropagation();
            gate.release = () => {
              gate.release = undefined;
              worker.dispatchEvent(
                new MessageEvent('message', { data: event.data })
              );
            };
          });
        }
        return worker;
      },
    });
  });
}

async function stageCameraScene() {
  const directory = makeTempDir(STEM);
  fs.writeFileSync(
    path.join(directory, SOURCE_NAME),
    createNrrdVolume({
      scalars: syntheticScalars(),
      dimensions: reference.size,
      spacing: reference.spacing,
    })
  );
  fs.writeFileSync(path.join(directory, MASK_NAME), syntheticMask());
  await writeManifestToFile(
    { layouts: { 'Projection camera': [['axial'], ['enface']] } },
    STEM + '.json'
  );
}

async function openCameraScene(empty = false) {
  await volViewPage.open(
    '?urls=[tmp/' +
      STEM +
      '.json' +
      (empty ? '' : ',tmp/' + STEM + '/' + SOURCE_NAME) +
      ']'
  );
}

async function panAndZoom() {
  await browser.keys('Escape');
  await $(CANVAS).click();
  const initial = await projectionTransform();
  await $('button[data-testid^="control-button-Pan "]').click();
  await dragContrast(await $(CANVAS).getElement(), 40, 20);
  await browser.waitUntil(
    async () => Math.abs((await projectionTransform())[4] - initial[4]) > 1
  );
  const panned = await projectionTransform();
  await $('button[data-testid^="control-button-Zoom "]').click();
  await dragContrast(await $(CANVAS).getElement(), 0, -40);
  await browser.waitUntil(
    async () => Math.abs((await projectionTransform())[0] - panned[0]) > 0.01
  );
  await waitForEnFaceReady();
  return {
    transform: await projectionTransform(),
    image: (await enFaceAppearance()).image,
  };
}

async function expectCameraAndPixels(
  inspected: Awaited<ReturnType<typeof panAndZoom>>
) {
  await waitForEnFaceReady();
  await expectProjectionTransform(inspected.transform);
  await browser.waitUntil(
    async () => (await enFaceAppearance()).image === inspected.image,
    { timeoutMsg: 'Expected the saved projection pixels and camera framing' }
  );
}

async function saveScene() {
  const saved = await volViewPage.saveSession();
  await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
  return saved;
}

async function expectSourceMaskPixels(expectedImage?: string) {
  const canvas = await $(
    'div[data-testid~="vtk-two-view"] canvas'
  ).getElement();
  let image = '';
  await browser.waitUntil(
    async () => {
      const rendered = await canvasAppearance(canvas);
      image = rendered.image;
      return (
        rendered.coloredPixels > 100 &&
        rendered.visiblePixels > 1000 &&
        (expectedImage === undefined || image === expectedImage)
      );
    },
    { timeoutMsg: 'Expected saved segmentation pixels and source framing' }
  );
  return image;
}

async function releaseMaskAfterReachableProjection(
  inspected: Awaited<ReturnType<typeof panAndZoom>>
) {
  await browser.waitUntil(() =>
    browser.execute(
      () => (window as unknown as MaskGateWindow).maskRestoreGate.entered
    )
  );
  await expect($(VIEWER + ' .annotation-cell')).toHaveText(
    expect.stringContaining(SOURCE_NAME)
  );
  await expectCameraAndPixels(inspected);
  const sourceCanvas = await $(
    'div[data-testid~="vtk-two-view"] canvas'
  ).getElement();
  await browser.waitUntil(
    async () => (await canvasAppearance(sourceCanvas)).visiblePixels > 1000
  );
  expect((await canvasAppearance(sourceCanvas)).coloredPixels).toBe(0);
  await browser.execute(() => {
    const gate = (window as unknown as MaskGateWindow).maskRestoreGate;
    if (!gate.release) throw new Error('No decoded archived mask is held');
    gate.release();
  });
}

describe('Projection camera persistence', () => {
  useReferenceLines();

  before(installMaskDecodeGate);

  for (const explicitReset of [false, true]) {
    it(
      'persists navigation with automatic reset disabled ' +
        (explicitReset ? 'after explicit Reset Views' : 'before any reset'),
      async () => {
        await stageCameraScene();
        await openCameraScene(true);
        const dialog = await volViewPage.openSettings();
        const preference = dialog.$('label*=Camera Auto Reset');
        await preference.waitForClickable();
        await preference.click();
        await expect(preference.parentElement().$('input')).toBeSelected();
        await volViewPage.closeSettings();
        await preference.waitForDisplayed({ reverse: true });
        await openThroughDialog(path.join(TEMP_DIR, STEM, SOURCE_NAME));
        await waitForEnFaceReady();
        if (explicitReset)
          await $('button[data-testid="control-button-Reset Views"]').click();
        const inspected = await panAndZoom();
        const sourceCanvas = () => $('div[data-testid~="vtk-two-view"] canvas');
        await sourceCanvas().doubleClick();
        await expect($(CANVAS)).not.toExist();
        await sourceCanvas().waitForStable();
        await sourceCanvas().doubleClick();
        await expectCameraAndPixels(inspected);
        const saved = await saveScene();
        await volViewPage.open('?urls=[tmp/' + saved + ']');
        await expectCameraAndPixels(inspected);
        expect(await volViewPage.getNotificationsCount()).toBe(0);
      }
    );
  }

  it('restores a nondefault-axis camera after the archived mask finishes decoding', async () => {
    await stageCameraScene();
    await openCameraScene();
    await waitForEnFaceReady();
    await attachAndSelectMask(STEM + '/' + MASK_NAME, SEGMENT_NAME);
    await openEnFaceProjection();
    await selectSetting('enface-projection-axis', 'Sagittal');
    await setSlabRange(10, 100);
    await waitForEnFaceReady();
    const inspected = await panAndZoom();
    const sourceMaskImage = await expectSourceMaskPixels();
    const saved = await saveScene();

    await volViewPage.open();
    await browser.execute(() => {
      (window as unknown as MaskGateWindow).maskRestoreGate.armed = true;
    });
    await openThroughDialog(path.join(TEMP_DIR, saved));
    await releaseMaskAfterReachableProjection(inspected);
    await expectSourceMaskPixels(sourceMaskImage);
    await expectCameraAndPixels(inspected);
    await openEnFaceControls();
    await expectEnFaceProjectionSettings('Sagittal', 10, 100);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
