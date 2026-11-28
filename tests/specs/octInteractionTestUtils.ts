import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import {
  createVolViewPage,
  waitForTransitions,
} from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import {
  CANVAS,
  CONTROLS,
  MENU_PANEL,
  WINDOW_TOOL,
  createOctUtils,
  displayedWindow,
  stageIllustrativeMask,
} from './octTestUtils';
import { createUtils } from './utils';
import { syntheticMask } from '../fixtures/oct/volumes';
import reference from '../fixtures/oct/reference.json' with { type: 'json' };
import { createSyntheticOCT } from '../fixtures/oct/dicom';
import { createProbeUtils } from './probeTestUtils';
import { createSegmentationUtils } from './segmentationTestUtils';

export { reference };

export const SYNTHETIC_OCT_GEOMETRY = {
  origin: [0, 0, 0],
  spacing: reference.spacing,
};

// Both sit on the synthetic B-scan in its axial and coronal views.
export const SYNTHETIC_OCT_PROBE_POINTS = [
  [0.2, 0.5],
  [0.8, 0.5],
] as const;

export const SLICE_LINE = '[data-testid="enface-slice-lines"] line';

export const STEM = 'oct-fixtures-' + process.pid;

export const createOctInteractionUtils = (page: Page, scratch: Scratch) => {
  const volview = createVolViewPage(page, scratch);
  const utils = createUtils(page, scratch);
  const oct = createOctUtils(page, scratch);
  const probe = createProbeUtils(page);
  const segmentation = createSegmentationUtils(page, scratch);
  const canvas = page.locator(CANVAS).first();

  const stageFixture = (name: string) => {
    const directory = utils.makeTempDir(STEM);
    fs.writeFileSync(
      path.join(directory, name),
      name.endsWith('.dcm') ? createSyntheticOCT() : syntheticMask()
    );
    return STEM + '/' + name;
  };

  const expectProjectionPixel = (gray: number, x = 60, y = 12) =>
    oct.expectEnFacePixel(gray, [x, y]);

  const observeSlabProjectionChanges = async () => {
    await page.evaluate(() => {
      const viewer = document.querySelector('[data-testid="enface-viewer"]')!;
      const threshold = document.querySelector(
        '.v-overlay--active [data-testid="enface-segment-threshold"] [role="slider"]'
      )!;
      const changes: string[] = [];
      const observer = new MutationObserver((records) => {
        records.forEach((record) => changes.push(record.attributeName!));
      });
      observer.observe(viewer, { attributeFilter: ['aria-busy'] });
      observer.observe(threshold, { attributeFilter: ['aria-valuemax'] });
      Object.assign(window, {
        readSlabProjectionChanges: () => {
          observer.disconnect();
          return changes;
        },
      });
    });
    return () =>
      page.evaluate(() =>
        (
          window as typeof window & {
            readSlabProjectionChanges: () => string[];
          }
        ).readSlabProjectionChanges()
      );
  };

  const dragEnFaceContrast = async () => {
    const windowTool = page.locator(WINDOW_TOOL);
    await volview.closeMenu(windowTool);
    await volview.closeMenu(page.locator(CONTROLS).first());
    await canvas.click();
    await expect(page.locator(MENU_PANEL)).toBeHidden();
    await expect(windowTool).toBeVisible();
    await expect(windowTool).toBeEnabled();
    if (
      !((await windowTool.getAttribute('class')) ?? '').includes(
        'tool-btn-selected'
      )
    )
      await windowTool.click();
    const before = await oct.getEnFaceWindow();
    await oct.dragContrast(canvas, 60, 40);
    await expect
      .poll(async () => {
        const after = await oct.getEnFaceWindow();
        return after.width !== before.width && after.level !== before.level;
      })
      .toBe(true);
  };

  const getOriginalWindow = () => displayedWindow(volview.views2D.first());

  const openHighlightedSegmentationDisplay = async (segment: string) => {
    await oct.openEnFaceControls();
    await oct.setSegmentThreshold(segment, 31);
    await oct.expectHighlight(true);
    await page.keyboard.press('Escape');
    await segmentation.openSegmentDisplay();
  };

  const expectCalibratedEnFace = async () => {
    await oct.waitForEnFaceReady();
    await probe.expectProbedPositions(
      volview.views2D.first(),
      SYNTHETIC_OCT_GEOMETRY,
      SYNTHETIC_OCT_PROBE_POINTS
    );
    expect(await volview.getNotificationsCount()).toBe(0);
  };

  const expectStackedMaskWithoutSidebar = async () => {
    if (
      ((await page.locator('#left-nav').getAttribute('class')) ?? '').includes(
        'v-navigation-drawer--active'
      )
    )
      await page.locator('header i.mdi-menu').click();
    await waitForTransitions(canvas);
    await oct.expectStackedSourceMask();
  };

  const openRetina = async (withMask = false, comparison = false) => {
    const image = stageFixture('synthetic-oct.dcm');
    await utils.writeManifestToFile(
      {
        layouts: {
          'OCT test': comparison ? [['axial'], ['enface']] : [['axial']],
        },
      },
      STEM + '.json'
    );
    await volview.open('?urls=[tmp/' + STEM + '.json,tmp/' + image + ']');
    await volview.waitForViews();
    await probe.expectProbedPositions(
      volview.views2D.first(),
      SYNTHETIC_OCT_GEOMETRY,
      SYNTHETIC_OCT_PROBE_POINTS
    );
    if (comparison) await expect(canvas).toBeVisible();
    else await oct.selectEnFace();
    await oct.waitForEnFaceReady();
    if (withMask) {
      const mask = comparison
        ? STEM + '/' + stageIllustrativeMask(utils.makeTempDir(STEM))
        : stageFixture('synthetic-thickness.nrrd');
      await oct.attachAndSelectMask(
        mask,
        comparison ? 'Synthetic retinal layer' : 'Synthetic retinal band'
      );
    }
    await oct.openEnFaceControls();
  };

  const expectSliceLine = async () => {
    const tolerance = 64 * Number.EPSILON * Math.max(...reference.size);
    const lines = page.locator(SLICE_LINE);
    await expect
      .poll(
        async () => {
          const slice = await volview.getFirst2DSlice();
          return (
            (await lines.count()) === 1 &&
            slice !== undefined &&
            Math.abs(
              Number(await lines.first().getAttribute('y1')) - (slice - 0.5)
            ) <= tolerance
          );
        },
        {
          message:
            'Expected the enface marker to follow the original OCT B-scan',
        }
      )
      .toBe(true);
    const slice = await volview.getFirst2DSlice();
    if (slice === undefined)
      throw new Error('The original OCT view has no slice position');
    const line = lines.first();
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
      await line.evaluate((element) =>
        getComputedStyle(element).stroke.replace(/\s/g, '')
      )
    ).toBe('rgb(255,255,0)');
  };

  return {
    stageFixture,
    expectProjectionPixel,
    observeSlabProjectionChanges,
    dragEnFaceContrast,
    getOriginalWindow,
    openHighlightedSegmentationDisplay,
    expectCalibratedEnFace,
    expectStackedMaskWithoutSidebar,
    openRetina,
    expectSliceLine,
  };
};

export type OctInteractionUtils = ReturnType<typeof createOctInteractionUtils>;
