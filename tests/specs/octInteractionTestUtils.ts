import fs from 'node:fs';
import { useReferenceLines } from './referenceLinesTestUtils';
import path from 'node:path';
import {
  dragContrast,
  attachAndSelectMask,
  expectEnFacePixel,
  waitForEnFaceReady,
  stageIllustrativeMask,
  expectStackedSourceMask,
  getEnFaceWindow as getWindow,
  displayedWindow,
  selectEnFace,
  openEnFaceControls,
  CANVAS,
  CONTROLS,
  PANEL,
  WINDOW_TOOL,
} from './octTestUtils';
import { volViewPage } from '../pageobjects/volview.page';
import { makeTempDir, writeManifestToFile } from './utils';
import { applyTestViewport } from '../../wdio.shared.conf';
import { syntheticMask } from '../fixtures/oct/volumes';
import reference from '../fixtures/oct/reference.json';
import { createSyntheticOCT } from '../fixtures/oct/dicom';
import { waitForFirstCachedImageSpacing } from './imageCacheUtils';

export { reference };

export const SLICE_LINE = '[data-testid="enface-slice-lines"] line';

export const STEM = 'oct-fixtures-' + process.pid;

export function stageFixture(name: string) {
  const directory = makeTempDir(STEM);
  fs.writeFileSync(
    path.join(directory, name),
    name.endsWith('.dcm') ? createSyntheticOCT() : syntheticMask()
  );
  return STEM + '/' + name;
}

export async function expectProjectionPixel(gray: number, x = 60, y = 12) {
  await expectEnFacePixel(gray, [x, y]);
}

export async function dragEnFaceContrast() {
  await volViewPage.closeMenu($(WINDOW_TOOL));
  await volViewPage.closeMenu($(CONTROLS));
  await $(CANVAS).waitForClickable();
  await $(CANVAS).click();
  await $(PANEL).waitForDisplayed({
    reverse: true,
  });
  await $(WINDOW_TOOL).waitForClickable();
  if (
    !((await $(WINDOW_TOOL).getAttribute('class')) ?? '').includes(
      'tool-btn-selected'
    )
  )
    await $(WINDOW_TOOL).click();
  const before = await getWindow();
  await dragContrast(await $(CANVAS).getElement(), 60, 40, { duration: 300 });
  await browser.waitUntil(async () => {
    const after = await getWindow();
    return after.width !== before.width && after.level !== before.level;
  });
}

export async function getOriginalWindow() {
  const source = await (await volViewPage.getViews2D())[0].getElement();
  return displayedWindow(source);
}

export async function expectCalibratedEnFace() {
  await waitForEnFaceReady();
  const spacing = await waitForFirstCachedImageSpacing();
  spacing.forEach((value, axis) =>
    expect(value).toBeCloseTo(reference.spacing[axis], 6)
  );
  expect(await volViewPage.getNotificationsCount()).toBe(0);
}

export async function expectStackedMaskWithoutSidebar() {
  if (
    ((await $('#left-nav').getAttribute('class')) ?? '').includes(
      'v-navigation-drawer--active'
    )
  )
    await $('header i.mdi-menu').click();
  await $(CANVAS).waitForStable();
  await expectStackedSourceMask();
}

export async function openRetina(withMask = false, comparison = false) {
  const image = stageFixture('synthetic-oct.dcm');
  await writeManifestToFile(
    {
      layouts: {
        'OCT test': comparison ? [['axial'], ['enface']] : [['axial']],
      },
    },
    STEM + '.json'
  );
  await volViewPage.open('?urls=[tmp/' + STEM + '.json,tmp/' + image + ']');
  await volViewPage.waitForViews();
  const spacing = await waitForFirstCachedImageSpacing();
  spacing.forEach((value, axis) =>
    expect(value).toBeCloseTo(reference.spacing[axis], 6)
  );
  if (comparison) await $(CANVAS).waitForDisplayed();
  else await selectEnFace();
  await waitForEnFaceReady();
  if (withMask) {
    const mask = comparison
      ? STEM + '/' + stageIllustrativeMask(makeTempDir(STEM))
      : stageFixture('synthetic-thickness.nrrd');
    await attachAndSelectMask(
      mask,
      comparison ? 'Synthetic retinal layer' : 'Synthetic retinal band'
    );
  }
  await openEnFaceControls();
}

export async function expectSliceLine() {
  const tolerance = 64 * Number.EPSILON * Math.max(...reference.size);
  await browser.waitUntil(
    async () => {
      const lines = await $$(SLICE_LINE);
      const slice = await volViewPage.getFirst2DSlice();
      return (
        (await lines.length) === 1 &&
        slice !== null &&
        Math.abs(Number(await lines[0].getAttribute('y1')) - (slice - 0.5)) <=
          tolerance
      );
    },
    {
      timeoutMsg:
        'Expected the enface marker to follow the original OCT B-scan',
    }
  );
  const slice = await volViewPage.getFirst2DSlice();
  if (slice === null)
    throw new Error('The original OCT view has no slice position');
  const line = $(SLICE_LINE);
  for (const [attribute, expected] of [
    ['x1', 0],
    ['x2', reference.size[0]],
    ['y1', slice - 0.5],
    ['y2', slice - 0.5],
  ] as const) {
    expect(
      Math.abs(Number(await line.getAttribute(attribute)) - expected)
    ).toBeLessThanOrEqual(tolerance);
  }
  expect(
    await line.execute((element) =>
      getComputedStyle(element).stroke.replace(/\s/g, '')
    )
  ).toBe('rgb(255,255,0)');
}

export function registerOctTestHooks() {
  useReferenceLines();
  afterEach(async function () {
    const captureDirectory = process.env.VOLVIEW_OCT_CAPTURE_DIR;
    if (captureDirectory && this.currentTest?.state === 'failed') {
      fs.mkdirSync(captureDirectory, { recursive: true });
      await browser.saveScreenshot(
        path.join(
          captureDirectory,
          'failure-' + this.currentTest.title.slice(0, 20) + '.png'
        )
      );
    }
    await applyTestViewport(browser);
  });
}
