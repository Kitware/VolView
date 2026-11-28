import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { test, expect, useReferenceLines } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import { createNrrdVolume } from '../fixtures/oct/volumes';
import { displayedWindow, VIEWER, type OctUtils } from './octTestUtils';
import {
  expectNoRedrawInterruption,
  observeProjectionRedraw,
} from './slabContrastTestUtils';
import type { Utils } from './utils';

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

async function saveArchive(volview: VolViewPage, scratch: Scratch) {
  const saved = await volview.saveSession();
  const archive = await JSZip.loadAsync(fs.readFileSync(scratch.path(saved)));
  const manifest = JSON.parse(
    await archive.file('manifest.json')!.async('text')
  );
  return { archive, manifest };
}

async function openSlab(
  {
    page,
    volview,
    utils,
    oct,
  }: { page: Page; volview: VolViewPage; utils: Utils; oct: OctUtils },
  values: number[]
) {
  const dimensions = [16, values.length, 8];
  const scalars = Uint16Array.from(
    { length: dimensions.reduce((a, b) => a * b) },
    (_, index) => values[Math.floor(index / 16) % values.length]
  );
  fs.writeFileSync(
    path.join(utils.makeTempDir(STEM), 'source.nrrd'),
    createNrrdVolume({ scalars, dimensions, spacing: [1, 1, 1] })
  );
  await utils.writeManifestToFile(
    { layouts: { Slabs: [['axial'], ['enface']] } },
    STEM + '.json'
  );
  await volview.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/source.nrrd]`);
  await oct.waitForEnFaceReady();
  const view = page.locator(VIEWER).first();
  await oct.setEnFaceWindow(WINDOW.width, WINDOW.level, view);
  return view;
}

async function expectIntensity(oct: OctUtils, value: number) {
  const gray = Math.round((value / WINDOW.width) * 255);
  await oct.expectEnFacePixel(gray, [8, 4]);
}

test.describe('Built-in reslice slab rendering', () => {
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
    test(scenario.name, async ({ page, volview, utils, oct }) => {
      const view = await openSlab(
        { page, volview, utils, oct },
        scenario.values
      );
      const source = page.locator('[data-testid~="vtk-two-view"]').first();
      const sourceWindow = await displayedWindow(source);
      await observeProjectionRedraw(view);
      await oct.setEnFaceSlab(scenario.first, scenario.last, view);
      for (const [index, method] of ['Mean', 'Maximum', 'Sum'].entries()) {
        await oct.chooseEnFaceProjection(
          'enface-projection-method',
          method,
          view
        );
        await oct.setEnFaceWindow(WINDOW.width, WINDOW.level, view);
        await oct.waitForEnFaceReady(view);
        await expectIntensity(oct, scenario.expected[index]);
        expect(await oct.getEnFaceWindow(view)).toEqual(WINDOW);
      }
      expect(await displayedWindow(source)).toEqual(sourceWindow);
      await expectNoRedrawInterruption(view);
      expect(await volview.getNotificationsCount()).toBe(0);
    });

  test('clamps oversized saved slab bounds without diluting the mean at a volume edge', async ({
    page,
    volview,
    utils,
    oct,
    scratch,
  }) => {
    await openSlab(
      { page, volview, utils, oct },
      Array.from({ length: 15 }, () => 400)
    );
    await expectIntensity(oct, 400);
    const { archive, manifest } = await saveArchive(volview, scratch);
    const settings = savedSlabs(manifest);
    expect(settings).toHaveLength(1);
    settings[0].depthEnd = 999;
    archive.file('manifest.json', JSON.stringify(manifest));
    fs.writeFileSync(
      path.join(utils.makeTempDir(STEM), 'oversized.volview.zip'),
      await archive.generateAsync({ type: 'nodebuffer' })
    );
    await volview.open(`?urls=[tmp/${STEM}/oversized.volview.zip]`);
    await oct.waitForEnFaceReady();
    await expectIntensity(oct, 400);
    await oct.openEnFaceProjection();
    await expect(oct.slabThumb('end')).toHaveAttribute('aria-valuenow', '14');
    await page.keyboard.press('Escape');
    const clamped = await saveArchive(volview, scratch);
    expect(savedSlabs(clamped.manifest)).toMatchObject([
      { depthStart: 0, depthEnd: 14 },
    ]);
    await oct.setEnFaceSlab(10, 14);
    await oct.waitForEnFaceReady();
    await expectIntensity(oct, 400);
    expect(await oct.getEnFaceWindow()).toEqual(WINDOW);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
