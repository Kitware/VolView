import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { createNrrdVolume } from '../fixtures/oct/volumes';
import {
  chooseEnFaceProjection,
  displayedWindow,
  expectEnFacePixel,
  getEnFaceWindow,
  setEnFaceWindow,
  slabThumb,
  waitForEnFaceReady,
  VIEWER,
  openEnFaceProjection,
  setEnFaceSlab,
} from './octTestUtils';
import { useReferenceLines } from './referenceLinesTestUtils';
import {
  expectNoRedrawInterruption,
  observeProjectionRedraw,
} from './slabContrastTestUtils';
import {
  makeTempDir,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  writeManifestToFile,
} from './utils';

const STEM = 'stock-reslice-slabs';
const WINDOW = { width: 1000, level: 500 };

type SavedView = {
  type: string;
  config: Record<
    string,
    { enFace?: { depthStart: number; depthEnd: number | null } }
  >;
};

const savedSlabs = (manifest: { viewByID: Record<string, SavedView> }) =>
  Object.values(manifest.viewByID)
    .filter((view) => view.type === 'EnFace')
    .flatMap((view) => Object.values(view.config))
    .flatMap((config) => (config.enFace ? [config.enFace] : []));

async function saveArchive() {
  const saved = await volViewPage.saveSession();
  await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
  const archive = await JSZip.loadAsync(
    fs.readFileSync(path.join(TEMP_DIR, saved))
  );
  const manifest = JSON.parse(
    await archive.file('manifest.json')!.async('text')
  );
  return { archive, manifest };
}

async function openSlab(values: number[]) {
  const dimensions = [16, values.length, 8];
  const scalars = Uint16Array.from(
    { length: dimensions.reduce((a, b) => a * b) },
    (_, index) => values[Math.floor(index / 16) % values.length]
  );
  fs.writeFileSync(
    path.join(makeTempDir(STEM), 'source.nrrd'),
    createNrrdVolume({ scalars, dimensions, spacing: [1, 1, 1] })
  );
  await writeManifestToFile(
    { layouts: { Slabs: [['axial'], ['enface']] } },
    STEM + '.json'
  );
  await volViewPage.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/source.nrrd]`);
  await waitForEnFaceReady();
  const view = await $(VIEWER).getElement();
  await setEnFaceWindow(WINDOW.width, WINDOW.level, view);
  return view;
}

async function expectIntensity(value: number) {
  const gray = Math.round((value / WINDOW.width) * 255);
  await expectEnFacePixel(gray, [8, 4]);
}

describe('Built-in reslice slab rendering', () => {
  useReferenceLines();

  for (const scenario of [
    {
      name: 'combines physical samples with Mean, Maximum and Sum',
      values: [0, 20, 40, 60, 80],
      first: 0,
      last: 4,
      expected: [40, 80, 360],
    },
    {
      name: 'keeps bright voxels outside a selected physical slab out of every projection',
      values: [0, 40, 40, 40, 400, 40, 40, 40, 40, 40, 400, 40, 40, 40, 0],
      first: 5,
      last: 9,
      expected: [40, 40, 360],
    },
    {
      name: 'uses an ordinary slice when the selected slab has one depth',
      values: [0, 20, 40, 60, 80],
      first: 2,
      last: 2,
      expected: [40, 40, 40],
    },
  ])
    it(scenario.name, async () => {
      const view = await openSlab(scenario.values);
      const source = await $('[data-testid~="vtk-two-view"]').getElement();
      const sourceWindow = await displayedWindow(source);
      await observeProjectionRedraw(view);
      await setEnFaceSlab(scenario.first, scenario.last, view);
      for (const [index, method] of ['Mean', 'Maximum', 'Sum'].entries()) {
        await chooseEnFaceProjection('enface-projection-method', method, view);
        await setEnFaceWindow(WINDOW.width, WINDOW.level, view);
        await waitForEnFaceReady(view);
        await expectIntensity(scenario.expected[index]);
        expect(await getEnFaceWindow(view)).toEqual(WINDOW);
      }
      expect(await displayedWindow(source)).toEqual(sourceWindow);
      await expectNoRedrawInterruption(view);
      expect(await volViewPage.getNotificationsCount()).toBe(0);
    });

  it('clamps oversized saved slab bounds without diluting the mean at a volume edge', async () => {
    await openSlab(Array.from({ length: 15 }, () => 400));
    await expectIntensity(400);
    const { archive, manifest } = await saveArchive();
    const settings = savedSlabs(manifest);
    expect(settings).toHaveLength(1);
    settings[0].depthEnd = 999;
    archive.file('manifest.json', JSON.stringify(manifest));
    fs.writeFileSync(
      path.join(makeTempDir(STEM), 'oversized.volview.zip'),
      await archive.generateAsync({ type: 'nodebuffer' })
    );
    await volViewPage.open(`?urls=[tmp/${STEM}/oversized.volview.zip]`);
    await waitForEnFaceReady();
    await expectIntensity(400);
    await openEnFaceProjection();
    await expect(slabThumb('end')).toHaveAttribute('aria-valuenow', '14');
    await browser.keys('Escape');
    const clamped = await saveArchive();
    expect(savedSlabs(clamped.manifest)).toMatchObject([
      { depthStart: 0, depthEnd: 14 },
    ]);
    await setEnFaceSlab(10, 14);
    await waitForEnFaceReady();
    await expectIntensity(400);
    expect(await getEnFaceWindow()).toEqual(WINDOW);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
