import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import {
  createVolViewPage,
  holdKey,
  setValueVueInput,
  waitForTransitions,
} from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import { createUtils } from './utils';
import {
  createVtiVolume,
  syntheticOCTGrid,
  syntheticOCTVolume,
  syntheticMask,
} from '../fixtures/oct/volumes';
import { createSegmentationUtils } from './segmentationTestUtils';

export function stageGenericOCT(
  directory: string,
  format: 'nrrd' | 'nii' | 'vti',
  unitsKnown = true
) {
  const name =
    'synthetic-oct' + (unitsKnown ? '' : '-unknown-units') + '.' + format;
  let bytes: Buffer;
  if (format === 'vti') {
    const volume = syntheticOCTGrid();
    const spacing = [...volume.spacing];
    spacing[0] *= -1;
    bytes = Buffer.from(
      createVtiVolume({
        dimensions: volume.dimensions,
        spacing,
        type: 'UInt16',
        values: volume.scalars,
      })
    );
  } else bytes = syntheticOCTVolume(format, unitsKnown);
  fs.writeFileSync(path.join(directory, name), bytes);
  return name;
}

export function stageIllustrativeMask(directory: string) {
  const name = 'illustrative-layer.nrrd';
  fs.writeFileSync(path.join(directory, name), syntheticMask(true));
  return name;
}

export const CANVAS = '[data-testid="enface-canvas"]';
export const VIEWER = '[data-testid="enface-viewer"]';
export const CONTROLS = '[data-testid="enface-controls"]';
export const PANEL =
  '.v-overlay--active [data-testid="enface-rendering-panel"]';
export const SIDEBAR = '[data-testid="enface-sidebar-controls"]';
// The active class leaves as a menu starts closing, so "gone" checks match any
// menu-hosted panel instead.
export const MENU_PANEL = '.v-overlay [data-testid="enface-rendering-panel"]';
export const WINDOW_TOOL =
  'button[data-testid^="control-button-Window & Level "]';
/** Display gray for a scalar under window/level, as the slab shader maps it. */
export const windowedGray = (
  value: number,
  { width, level }: { width: number; level: number }
) => Math.round(255 * Math.min(1, Math.max(0, (value - level) / width + 0.5)));
const SECTIONS = ['projection', 'segments'] as const;
type EnFaceSection = (typeof SECTIONS)[number];
const sectionToggle = (section: EnFaceSection, scope = PANEL) =>
  scope + ' [data-testid="enface-' + section + '-toggle"]';

const scrollToCenter = (locator: Locator) =>
  locator.evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
  );

export async function displayedWindow(view: Locator) {
  const match = (await view.innerText()).match(
    /W\/L:\s*([-+\deE.]+)\s*\/\s*([-+\deE.]+)/
  );
  if (!match) throw new Error('The source view has no window-level annotation');
  return { width: Number(match[1]), level: Number(match[2]) };
}

export async function canvasAppearance(source: Locator) {
  return source.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d')!;
    context.drawImage(canvas, 0, 0);
    const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
    let visiblePixels = 0;
    let coloredPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (max > 20) visiblePixels++;
      if (max - min > 20) coloredPixels++;
    }
    return {
      image: copy.toDataURL(),
      visiblePixels,
      coloredPixels,
    };
  });
}

export const createOctUtils = (page: Page, scratch: Scratch) => {
  const volview = createVolViewPage(page, scratch);
  const utils = createUtils(page, scratch);
  const segmentation = createSegmentationUtils(page, scratch);
  // WebdriverIO's `$` took the first viewer and canvas on the page.
  const enFaceView = (view?: Locator) => view ?? page.locator(VIEWER).first();
  const firstCanvas = () => page.locator(CANVAS).first();
  const expectPanelGone = () => expect(page.locator(MENU_PANEL)).toBeHidden();

  const sourceMaskPixels = () =>
    page.evaluate(() => {
      const source = document.querySelector<HTMLCanvasElement>(
        'div[data-testid~="vtk-two-view"] canvas'
      );
      if (!source) throw new Error('Original OCT canvas is missing');
      const copy = document.createElement('canvas');
      copy.width = source.width;
      copy.height = source.height;
      const context = copy.getContext('2d');
      if (!context) throw new Error('Source canvas copy has no 2D context');
      context.drawImage(source, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
      let colored = 0;
      let gray = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 1] > pixels[i] + 12 && pixels[i + 2] > pixels[i] + 10)
          colored++;
        if (
          pixels[i] > 20 &&
          pixels[i] === pixels[i + 1] &&
          pixels[i] === pixels[i + 2]
        )
          gray++;
      }
      return { colored, gray };
    });

  const expectStackedSourceMask = async () => {
    await expect
      .poll(async () => (await sourceMaskPixels()).colored)
      .toBeGreaterThan(100);
    expect((await sourceMaskPixels()).gray).toBeGreaterThan(1000);
    const bounds = await page.evaluate(() => {
      const source = document
        .querySelector('div[data-testid~="vtk-two-view"]')
        ?.closest('.vtk-container-wrapper');
      const enface = document.querySelector('[data-testid="enface-viewer"]');
      if (!source || !enface)
        throw new Error('The stacked OCT views are missing');
      const top = source.getBoundingClientRect();
      const bottom = enface.getBoundingClientRect();
      return {
        sourceBottom: top.bottom,
        enfaceTop: bottom.top,
        sourceWidth: top.width,
        enfaceWidth: bottom.width,
        sourceLeft: top.left,
        enfaceLeft: bottom.left,
      };
    });
    expect(bounds.sourceBottom).toBeLessThanOrEqual(bounds.enfaceTop + 2);
    expect(bounds.sourceWidth).toBeGreaterThan(1000);
    expect(bounds.enfaceWidth).toBeCloseTo(bounds.sourceWidth, 0);
    expect(bounds.enfaceLeft).toBeCloseTo(bounds.sourceLeft, 0);
  };

  const expectControlsBesideSelector = async () => {
    const bounds = await page.evaluate(() => {
      const viewer = document.querySelector('[data-testid="enface-viewer"]');
      const button = viewer?.querySelector('[data-testid="enface-controls"]');
      const selector = viewer?.querySelector('.view-type-select');
      const canvas = viewer?.querySelector('canvas');
      const panel = document.querySelector(
        '.v-overlay--active [data-testid="enface-rendering-panel"]'
      );
      if (!button || !selector || !canvas || !panel)
        throw new Error('En face controls or image are missing');
      const tune = button.getBoundingClientRect();
      const select = selector.getBoundingClientRect();
      return {
        gap: select.left - tune.right,
        panelLeft: panel.getBoundingClientRect().left,
        panelRight: panel.getBoundingClientRect().right,
        viewportWidth: innerWidth,
      };
    });
    expect(bounds.gap).toBeGreaterThanOrEqual(0);
    expect(bounds.gap).toBeLessThan(12);
    expect(bounds.panelLeft).toBeGreaterThanOrEqual(0);
    expect(bounds.panelRight).toBeLessThanOrEqual(bounds.viewportWidth);
  };

  const toolButton = (name: string) =>
    page.locator('button[data-testid^="control-button-' + name + ' "]');

  const selectEnFace = async (viewIndex = 0) => {
    await page.locator('.view-type-select .v-field').nth(viewIndex).click();
    await utils.overlayOption('En face').click();
    await expect(firstCanvas()).toBeVisible();
  };

  const selectTwoRowLayout = async () => {
    const menu = await volview.openLayoutMenu();
    const gridCell = menu.locator('.grid-cell:nth-child(4)');
    await expect(gridCell).toBeVisible();
    await waitForTransitions(gridCell);
    await utils.moveToElement(gridCell);
    await gridCell.click();
    await page.keyboard.press('Escape');
  };

  const expandEnFaceSection = async (
    section: EnFaceSection = 'projection',
    scope = PANEL
  ) => {
    const toggle = page.locator(sectionToggle(section, scope));
    await scrollToCenter(toggle);
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();
    if ((await toggle.getAttribute('aria-expanded')) !== 'true')
      await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const content = toggle.locator('..').locator('.v-expansion-panel-text');
    await expect(content).toBeVisible();
    await waitForTransitions(content);
    await waitForTransitions(page.locator(scope));
  };

  const openEnFaceControls = async (view?: Locator) => {
    await volview.openMenu(enFaceView(view).locator(CONTROLS));
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible();
    await waitForTransitions(panel);
  };

  /** Expands the en face section of the open Rendering module. */
  const expandEnFaceSidebar = async () => {
    const toggle = page.locator('[data-testid="enface-rendering-toggle"]');
    await toggle.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();
    if ((await toggle.getAttribute('aria-expanded')) !== 'true')
      await toggle.click();
    await expect(page.locator(SIDEBAR)).toBeVisible();
    await waitForTransitions(toggle.locator('..'));
  };

  const openEnFaceSidebarControls = async () => {
    await page.keyboard.press('Escape');
    await expectPanelGone();
    await volview.renderingModuleTab.click();
    await utils.waitForModuleTransitions();
    await expandEnFaceSidebar();
    return SIDEBAR;
  };

  /** Checks a segment's en face eye is on at `threshold`, then closes the menu. */
  const expectEnFaceSegmentShown = async (name: string, threshold: string) => {
    await openEnFaceControls();
    await expandEnFaceSection('segments');
    await expect(segmentEye(name)).toHaveAttribute('aria-pressed', 'true');
    await expect(segmentThreshold(name)).toHaveValue(threshold);
    await page.keyboard.press('Escape');
  };

  const enFaceSegmentRow = (name: string, scope = PANEL) =>
    page
      .locator(scope)
      .locator(
        '[data-testid="enface-segment-row"][data-segment-name="' + name + '"]'
      );

  const segmentEye = (name: string, scope = PANEL) =>
    enFaceSegmentRow(name, scope).locator(
      '[data-testid="enface-segment-visible"]'
    );

  const segmentThreshold = (name: string, scope = PANEL) =>
    enFaceSegmentRow(name, scope).locator(
      '[data-testid="enface-segment-threshold-input"] input'
    );

  const segmentThresholdSlider = (name: string, scope = PANEL) =>
    enFaceSegmentRow(name, scope).locator(
      '[data-testid="enface-segment-threshold"] [role="slider"]'
    );

  const setSegmentShown = async (
    name: string,
    shown: boolean,
    scope = PANEL
  ) => {
    await expandEnFaceSection('segments', scope);
    const eye = segmentEye(name, scope);
    await scrollToCenter(eye);
    await expect(eye).toBeVisible();
    await expect(eye).toBeEnabled();
    if ((await eye.getAttribute('aria-pressed')) !== String(shown))
      await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', String(shown));
  };

  /** Null keeps every region of the segment. */
  const setSegmentThreshold = async (
    name: string,
    value: number | null,
    scope = PANEL
  ) => {
    await setSegmentShown(name, true, scope);
    const input = segmentThreshold(name, scope);
    await scrollToCenter(input);
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
    await setValueVueInput(input, value === null ? '' : String(value));
  };

  const enFaceAppearance = (view?: Locator) =>
    canvasAppearance(enFaceView(view).locator(CANVAS));

  const waitForEnFaceReady = async (view?: Locator) => {
    const viewer = enFaceView(view);
    await expect(viewer.locator(CANVAS)).toBeVisible();
    await expect(viewer).toHaveAttribute('aria-busy', 'false');
    const status = viewer.locator('[data-testid="enface-projection-status"]');
    await expect
      .poll(async () => (await status.textContent())?.trim(), {
        message: 'Expected the current projection to announce readiness',
      })
      .toBe('En face projection ready.');
  };

  const expectHighlight = async (present: boolean) => {
    await waitForEnFaceReady();
    await expect
      .poll(
        async () => {
          const { coloredPixels } = await enFaceAppearance();
          return present ? coloredPixels > 100 : coloredPixels === 0;
        },
        {
          message: `Expected enface highlight to be ${present ? 'visible' : 'hidden'}`,
        }
      )
      .toBe(true);
  };

  const openEnFaceProjection = async (view?: Locator) => {
    await openEnFaceControls(view);
    await expandEnFaceSection();
  };

  const selectSetting = async (
    testId: string,
    title: string,
    scope = PANEL
  ) => {
    const select = page
      .locator(scope)
      .locator('[data-testid="' + testId + '"]');
    await select.evaluate((element) =>
      element.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'instant',
      })
    );
    await select.click();
    const option = utils.overlayOption(title);
    // The option's overlay loses its active class on close, so follow the item.
    const item = await option.elementHandle();
    await option.click();
    await item?.waitForElementState('hidden');
  };

  const chooseEnFaceProjection = async (
    testId: string,
    label: string,
    view?: Locator
  ) => {
    const viewer = enFaceView(view);
    await volview.closeMenu(page.locator(WINDOW_TOOL));
    await openEnFaceProjection(viewer);
    await selectSetting(testId, label);
    await volview.closeMenu(viewer.locator(CONTROLS));
    await expectPanelGone();
  };

  const slabThumb = (bound: 'start' | 'end') =>
    page.locator(
      '.v-overlay--active [data-testid="enface-slab-range"] [role="slider"][aria-label="Slab ' +
        bound +
        '"]'
    );

  const expectEnFaceProjectionSettings = async (
    axis: string,
    start: number,
    end: number
  ) => {
    await expandEnFaceSection();
    await expect(
      page.locator(
        '.v-overlay--active [data-testid="enface-projection-axis"] input'
      )
    ).toHaveValue(axis);
    await expect(slabThumb('start')).toHaveAttribute(
      'aria-valuenow',
      String(start)
    );
    await expect(slabThumb('end')).toHaveAttribute(
      'aria-valuenow',
      String(end)
    );
  };

  const setSlabRange = async (start: number, end: number) => {
    for (const [bound, value] of [
      ['start', 0],
      ['end', end],
      ['start', start],
    ] as const) {
      const thumb = slabThumb(bound);
      if (Number(await thumb.getAttribute('aria-valuenow')) !== value) {
        await scrollToCenter(thumb);
        await expect(thumb).toBeVisible();
        await thumb.focus();
        await expect(thumb).toBeFocused();
        const min = Number(
          await (bound === 'end' ? slabThumb('start') : thumb).getAttribute(
            bound === 'end' ? 'aria-valuenow' : 'aria-valuemin'
          )
        );
        const max = Number(
          await (bound === 'start' ? slabThumb('end') : thumb).getAttribute(
            bound === 'start' ? 'aria-valuenow' : 'aria-valuemax'
          )
        );
        const fromMin = value - min <= max - value;
        const distance = fromMin ? value - min : max - value;
        await page.keyboard.press(fromMin ? 'Home' : 'End');
        await holdKey(page, fromMin ? 'ArrowRight' : 'ArrowLeft', distance);
      }
      await expect(thumb).toHaveAttribute('aria-valuenow', String(value));
    }
  };

  const setEnFaceSlab = async (start: number, end: number, view?: Locator) => {
    await openEnFaceProjection(view);
    await setSlabRange(start, end);
    await page.keyboard.press('Escape');
  };

  const dragContrast = async (
    canvas: Locator,
    dx: number,
    dy: number,
    { position = { x: 0.5, y: 0.5 } } = {}
  ) => {
    const box = await canvas.boundingBox();
    if (!box) throw new Error('The canvas is not on screen');
    const x = Math.round(box.x + box.width * position.x);
    const y = Math.round(box.y + box.height * position.y);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy);
    await page.mouse.up();
  };

  const enFaceScreenPoint = (x: number, y: number, view?: Locator) =>
    enFaceView(view)
      .locator('[data-testid="enface-slice-lines"] g')
      .first()
      .evaluate(
        (element, { imageX, imageY }) => {
          const transform = (element as SVGGElement).getScreenCTM()!;
          const point = new DOMPoint(imageX, imageY).matrixTransform(transform);
          return { x: point.x, y: point.y };
        },
        { imageX: x, imageY: y }
      );

  const enFacePixel = async (
    x: number,
    y: number,
    framebufferOffset = { x: 0, y: 0 },
    view?: Locator
  ) => {
    const viewer = enFaceView(view);
    const center = await enFaceScreenPoint(x + 0.5, y + 0.5, viewer);
    return viewer.locator(CANVAS).evaluate(
      (element, { screenPoint, offset }) => {
        const canvas = element as HTMLCanvasElement;
        const bounds = canvas.getBoundingClientRect();
        const capture = document.createElement('canvas').getContext('2d')!;
        Object.assign(capture.canvas, {
          width: canvas.width,
          height: canvas.height,
        });
        capture.drawImage(canvas, 0, 0);
        return Array.from(
          capture.getImageData(
            Math.floor(
              ((screenPoint.x - bounds.left) * canvas.width) / bounds.width
            ) + offset.x,
            Math.floor(
              ((screenPoint.y - bounds.top) * canvas.height) / bounds.height
            ) + offset.y,
            1,
            1
          ).data
        );
      },
      { screenPoint: center, offset: framebufferOffset }
    );
  };

  const expectEnFacePixel = (
    gray: number,
    point: readonly number[],
    view?: Locator
  ) =>
    expect
      .poll(
        async () => {
          const pixel = await enFacePixel(
            point[0],
            point[1],
            { x: 0, y: 0 },
            view
          );
          return (
            pixel[3] === 255 &&
            pixel.slice(0, 3).every((channel) => Math.abs(channel - gray) <= 1)
          );
        },
        {
          message: `Expected opaque enface pixel (${point}) to be grayscale ${gray}`,
        }
      )
      .toBe(true);

  const expectEnFaceUnavailable = async (reason: string) => {
    const viewer = enFaceView();
    await expect(viewer).toBeVisible();
    await expect(
      viewer.locator('[data-testid="enface-projection-status"]')
    ).toContainText(reason);
    await expect(viewer).toHaveAttribute('aria-busy', 'false');
    await expect(
      viewer.locator('[data-testid="enface-slice-lines"]')
    ).not.toBeAttached();
    expect((await enFaceAppearance(viewer)).visiblePixels).toBe(0);
    await openEnFaceProjection(viewer);
    const method = page.locator(
      '.v-overlay--active [data-testid="enface-projection-method"]'
    );
    await expect(method).toBeVisible();
    await expect(method.locator('input')).toBeDisabled();
    await page.keyboard.press('Escape');
  };

  const openEnFaceWindowInputs = async (view?: Locator) => {
    const viewer = enFaceView(view);
    const tool = page.locator(WINDOW_TOOL);
    await volview.closeMenu(tool);
    await volview.closeMenu(viewer.locator(CONTROLS));
    await viewer.locator(CANVAS).click();
    const menu = await volview.openMenu(tool);
    const first = menu.locator('.manual-inputs input').first();
    await expect(first).toBeVisible();
    await waitForTransitions(first);
    return menu.locator('.manual-inputs input').all();
  };

  const enterEnFaceWindow = async (
    width: number,
    level: number,
    view?: Locator
  ) => {
    const inputs = await openEnFaceWindowInputs(view);
    // Set the center before narrowing a window that may be constrained.
    await setValueVueInput(inputs[1], String(level));
    await setValueVueInput(inputs[0], String(width));
    return inputs;
  };

  const setEnFaceWindow = async (
    width: number,
    level: number,
    view?: Locator
  ) => {
    const inputs = await enterEnFaceWindow(width, level, view);
    await inputs[1].click();
    await expect
      .poll(async () => Number(await inputs[1].inputValue()), {
        message: 'The focused level field must retain its exact entered value',
      })
      .toBe(level);
    await inputs[0].click();
    await expect
      .poll(async () => Number(await inputs[0].inputValue()), {
        message: 'The focused width field must retain its exact entered value',
      })
      .toBe(width);
    await volview.closeMenu(page.locator(WINDOW_TOOL));
    await expect(inputs[0]).toBeHidden();
  };

  const getEnFaceWindow = async (view?: Locator) => {
    const viewer = enFaceView(view);
    const controls = viewer.locator(CONTROLS);
    const restorePanel =
      (await controls.getAttribute('aria-expanded')) === 'true';
    const expanded = await Promise.all(
      SECTIONS.map(
        async (section) =>
          restorePanel &&
          (await page
            .locator(sectionToggle(section))
            .getAttribute('aria-expanded')) === 'true'
      )
    );
    await volview.closeMenu(controls);
    if (restorePanel) await expectPanelGone();
    await expect(viewer.locator(CANVAS)).toBeVisible();
    const inputs = await openEnFaceWindowInputs(viewer);
    await inputs[0].click();
    const width = Number(await inputs[0].inputValue());
    await inputs[1].click();
    const result = { width, level: Number(await inputs[1].inputValue()) };
    await volview.closeMenu(page.locator(WINDOW_TOOL));
    await expect(inputs[0]).toBeHidden();
    if (restorePanel) {
      await volview.openMenu(controls);
      const reopened = page.locator(PANEL);
      await expect(reopened).toBeVisible();
      await waitForTransitions(reopened);
      for (const [index, section] of SECTIONS.entries()) {
        const toggle = page.locator(sectionToggle(section));
        if (expanded[index]) {
          await expandEnFaceSection(section);
        } else if ((await toggle.getAttribute('aria-expanded')) === 'true') {
          await scrollToCenter(toggle);
          await toggle.click();
        }
      }
      await waitForTransitions(reopened);
    }
    return result;
  };

  const expectEnFaceDisabledInSwitcher = async (reason: string) => {
    await page.locator('.view-type-select .v-field').first().click();
    const option = utils.overlayOption('En face');
    await expect(option).toBeVisible();
    expect(await option.getAttribute('class')).toContain(
      'v-list-item--disabled'
    );
    expect(await option.innerText()).toContain('En face');
    const activator = option.locator('..');
    await expect(activator).toHaveAttribute('tabindex', '0');
    await activator.focus();
    await expect(await segmentation.tooltipOf(activator)).toContainText(reason);
  };

  const projectionTransform = async (view?: Locator) => {
    const transform = await enFaceView(view)
      .locator('[data-testid="enface-slice-lines"] > g')
      .first()
      .getAttribute('transform');
    if (!transform) throw new Error('The projection has no image transform');
    return transform.slice(7, -1).split(',').map(Number);
  };

  const expectProjectionTransform = (expected: number[], view?: Locator) =>
    expect
      .poll(async () =>
        (await projectionTransform(view)).every(
          (value, index) => Math.abs(value - expected[index]) < 1e-4
        )
      )
      .toBe(true);

  const attachMaskThroughDataPanel = async (file: string) => {
    await utils.openThroughDialog(scratch.path(file));
    await page.locator('button[data-testid="module-tab-Data"]').click();
    await utils.waitForModuleTransitions();
    const card = page.locator(
      '.v-card:has([title="' + path.basename(file) + '"])'
    );
    await expect(card).toBeVisible();
    await waitForTransitions(card);
    const menu = card.locator('button.dataset-menu');
    await menu.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await menu.click();
    await utils.overlayOption('Add as segmentation').click();
  };

  /** Attaches a staged mask as a segmentation and selects one of its segments. */
  const attachAndSelectMask = async (file: string, segment: string) => {
    await attachMaskThroughDataPanel(file);
    await segmentation.openAnnotationSegments();
    await segmentation.waitForSegmentContent(segment);
    await segmentation.selectSegment(segment);
  };

  return {
    expectStackedSourceMask,
    expectControlsBesideSelector,
    toolButton,
    selectEnFace,
    selectTwoRowLayout,
    expandEnFaceSection,
    openEnFaceControls,
    expandEnFaceSidebar,
    openEnFaceSidebarControls,
    expectEnFaceSegmentShown,
    enFaceSegmentRow,
    segmentEye,
    segmentThreshold,
    segmentThresholdSlider,
    setSegmentShown,
    setSegmentThreshold,
    expectHighlight,
    openEnFaceProjection,
    selectSetting,
    chooseEnFaceProjection,
    slabThumb,
    expectEnFaceProjectionSettings,
    setSlabRange,
    setEnFaceSlab,
    dragContrast,
    enFaceAppearance,
    enFaceScreenPoint,
    enFacePixel,
    expectEnFacePixel,
    waitForEnFaceReady,
    expectEnFaceUnavailable,
    enterEnFaceWindow,
    setEnFaceWindow,
    getEnFaceWindow,
    expectEnFaceDisabledInSwitcher,
    projectionTransform,
    expectProjectionTransform,
    attachMaskThroughDataPanel,
    attachAndSelectMask,
  };
};

export type OctUtils = ReturnType<typeof createOctUtils>;
