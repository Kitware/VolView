import fs from 'node:fs';
import path from 'node:path';
import { Key } from 'webdriverio';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import {
  openThroughDialog,
  waitForModuleTransitions,
  overlayOption,
} from './utils';
import {
  syntheticOCTGrid,
  syntheticOCTVolume,
  syntheticMask,
} from '../fixtures/oct/volumes';
import {
  openAnnotationSegments,
  selectSegment,
  waitForSegmentContent,
} from './segmentationTestUtils';

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
    const [width, frames, depth] = volume.dimensions;
    const spacing = [...volume.spacing];
    spacing[0] *= -1;
    bytes = Buffer.from(
      '<VTKFile type="ImageData" version="1.0" byte_order="LittleEndian">' +
        '<ImageData WholeExtent="0 ' +
        (width - 1) +
        ' 0 ' +
        (frames - 1) +
        ' 0 ' +
        (depth - 1) +
        '" Origin="0 0 0" Spacing="' +
        spacing.join(' ') +
        '">' +
        '<Piece Extent="0 ' +
        (width - 1) +
        ' 0 ' +
        (frames - 1) +
        ' 0 ' +
        (depth - 1) +
        '"><PointData Scalars="intensity">' +
        '<DataArray type="UInt16" Name="intensity" format="ascii">' +
        Array.from(volume.scalars).join(' ') +
        '</DataArray></PointData><CellData/></Piece></ImageData></VTKFile>'
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
async function sourceMaskPixels() {
  return browser.execute(() => {
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
}

export async function expectStackedSourceMask() {
  await browser.waitUntil(async () => (await sourceMaskPixels()).colored > 100);
  expect((await sourceMaskPixels()).gray).toBeGreaterThan(1000);
  const bounds = await browser.execute(() => {
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
}

export async function expectControlsBesideSelector() {
  const bounds = await browser.execute(() => {
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
}

export const CANVAS = '[data-testid="enface-canvas"]';
export const VIEWER = '[data-testid="enface-viewer"]';
export const CONTROLS = '[data-testid="enface-controls"]';
export const PANEL =
  '.v-overlay--active [data-testid="enface-rendering-panel"]';
export const WINDOW_TOOL =
  'button[data-testid^="control-button-Window & Level "]';
const enFaceView = async (view?: WebdriverIO.Element) =>
  view ?? $(VIEWER).getElement();

export async function selectEnFace(viewIndex = 0) {
  const switcher = (await $$('.view-type-select .v-field'))[viewIndex];
  await switcher.click();
  const option = overlayOption('En face');
  await option.waitForExist();
  await option.waitForClickable();
  await option.click();
  await $(CANVAS).waitForExist();
  await $(CANVAS).waitForDisplayed();
}

export async function selectTwoRowLayout() {
  const menu = await volViewPage.openLayoutMenu();
  const gridCell = menu.$('.grid-cell:nth-child(4)');
  await gridCell.waitForDisplayed();
  await gridCell.waitForStable();
  await gridCell.waitForClickable();
  await gridCell.moveTo();
  await gridCell.click();
  await browser.keys('Escape');
}

export async function displayedWindow(view: WebdriverIO.Element) {
  const match = (await view.getText()).match(
    /W\/L:\s*([-+\deE.]+)\s*\/\s*([-+\deE.]+)/
  );
  if (!match) throw new Error('The source view has no window-level annotation');
  return { width: Number(match[1]), level: Number(match[2]) };
}

export async function expandEnFaceSection(section: 'projection' | 'thickness') {
  const toggle = $(
    '.v-overlay--active [data-testid="enface-' + section + '-toggle"]'
  );
  await toggle.scrollIntoView({ block: 'center', inline: 'nearest' });
  await toggle.waitForClickable();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const content = toggle.$('..').$('.v-expansion-panel-text');
  await content.waitForDisplayed();
  await content.waitForStable();
  await $(PANEL).waitForStable();
}

export async function chooseEnFaceProjection(
  testId: string,
  label: string,
  view?: WebdriverIO.Element
) {
  const viewer = await enFaceView(view);
  await volViewPage.closeMenu($(WINDOW_TOOL));
  const controls = viewer.$(CONTROLS);
  await volViewPage.openMenu(controls);
  const panel = $(PANEL);
  await panel.waitForDisplayed();
  await expandEnFaceSection('projection');
  const select = panel.$('[data-testid="' + testId + '"]');
  await select.scrollIntoView({ block: 'center', inline: 'nearest' });
  await select.waitForClickable();
  await select.click();
  const option = overlayOption(label);
  await option.waitForClickable();
  await option.click();
  await option.waitForDisplayed({ reverse: true });
  await volViewPage.closeMenu(controls);
  await panel.waitForDisplayed({ reverse: true });
}

export const slabThumb = (bound: 'start' | 'end') =>
  $(
    '.v-overlay--active [data-testid="enface-slab-range"] [role="slider"][aria-label="Slab ' +
      bound +
      '"]'
  );

export async function expectEnFaceProjectionSettings(
  axis: string,
  start: number,
  end: number
) {
  await expandEnFaceSection('projection');
  await expect(
    $('.v-overlay--active [data-testid="enface-projection-axis"] input')
  ).toHaveValue(axis);
  await expect(slabThumb('start')).toHaveAttribute(
    'aria-valuenow',
    String(start)
  );
  await expect(slabThumb('end')).toHaveAttribute('aria-valuenow', String(end));
}

export async function setSlabRange(start: number, end: number) {
  for (const [bound, value] of [
    ['start', 0],
    ['end', end],
    ['start', start],
  ] as const) {
    const thumb = slabThumb(bound);
    if (Number(await thumb.getAttribute('aria-valuenow')) !== value) {
      await thumb.scrollIntoView({ block: 'center', inline: 'nearest' });
      await thumb.waitForDisplayed();
      await thumb.execute((element) => (element as HTMLElement).focus());
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
      const endpoint = fromMin ? Key.Home : Key.End;
      const direction = fromMin ? Key.ArrowRight : Key.ArrowLeft;
      const distance = fromMin ? value - min : max - value;
      const keys = browser.action('key').down(endpoint).up(endpoint);
      for (let i = 0; i < distance; i++) keys.down(direction).up(direction);
      await keys.perform();
    }
    await expect(thumb).toHaveAttribute('aria-valuenow', String(value));
  }
}

export async function dragContrast(
  canvas: WebdriverIO.Element,
  dx: number,
  dy: number,
  { position = { x: 0.5, y: 0.5 }, duration = 100 } = {}
) {
  const location = await canvas.getLocation();
  const size = await canvas.getSize();
  const x = Math.round(location.x + size.width * position.x);
  const y = Math.round(location.y + size.height * position.y);
  await browser
    .action('pointer')
    .move({ x, y })
    .down()
    .move({ x: x + dx, y: y + dy, duration })
    .up()
    .perform();
}

export async function canvasAppearance(source: WebdriverIO.Element) {
  return source.execute((element) => {
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

export async function enFaceAppearance(view?: WebdriverIO.Element) {
  const viewer = await enFaceView(view);
  return canvasAppearance(await viewer.$(CANVAS).getElement());
}

export async function enFaceScreenPoint(
  x: number,
  y: number,
  view?: WebdriverIO.Element
) {
  const viewer = await enFaceView(view);
  const geometry = await viewer
    .$('[data-testid="enface-slice-lines"] g')
    .getElement();
  return geometry.execute(
    (element, imageX, imageY) => {
      const transform = (element as unknown as SVGGElement).getScreenCTM()!;
      const point = new DOMPoint(imageX, imageY).matrixTransform(transform);
      return { x: point.x, y: point.y };
    },
    x,
    y
  );
}

export async function enFacePixel(
  x: number,
  y: number,
  framebufferOffset = { x: 0, y: 0 },
  view?: WebdriverIO.Element
) {
  const viewer = await enFaceView(view);
  const source = await viewer.$(CANVAS).getElement();
  const center = await enFaceScreenPoint(x + 0.5, y + 0.5, viewer);
  return source.execute(
    (element, screenPoint, offset) => {
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
    center,
    framebufferOffset
  );
}

export async function expectEnFacePixel(
  gray: number,
  point: readonly number[],
  view?: WebdriverIO.Element
) {
  await browser.waitUntil(
    async () => {
      const pixel = await enFacePixel(point[0], point[1], { x: 0, y: 0 }, view);
      return (
        pixel[3] === 255 &&
        pixel.slice(0, 3).every((channel) => Math.abs(channel - gray) <= 1)
      );
    },
    {
      timeoutMsg: `Expected opaque enface pixel (${point}) to be grayscale ${gray}`,
    }
  );
}

export async function waitForEnFaceReady(view?: WebdriverIO.Element) {
  const viewer = await enFaceView(view);
  await viewer.$(CANVAS).waitForDisplayed();
  await expect(viewer).toHaveAttribute('aria-busy', 'false');
  const status = viewer.$('[data-testid="enface-projection-status"]');
  await browser
    .waitUntil(
      async () =>
        String(await status.getProperty('textContent')).trim() ===
        'En face projection ready.',
      { timeoutMsg: 'Expected the current projection to announce readiness' }
    )
    .catch(async (error: Error) => {
      error.message +=
        '; actual status: ' +
        String(await status.getProperty('textContent')).trim();
      throw error;
    });
}

export async function expectEnFaceUnavailable(reason: string) {
  const viewer = await enFaceView();
  await viewer.waitForDisplayed();
  await expect(viewer.$('[data-testid="enface-projection-status"]')).toHaveText(
    expect.stringContaining(reason)
  );
  await expect(viewer).toHaveAttribute('aria-busy', 'false');
  await expect(viewer.$('[data-testid="enface-slice-lines"]')).not.toExist();
  expect((await enFaceAppearance(viewer)).visiblePixels).toBe(0);
  await viewer.$(CONTROLS).click();
  await expandEnFaceSection('projection');
  const method = $(
    '.v-overlay--active [data-testid="enface-projection-method"]'
  );
  await expect(method).toBeDisplayed();
  await expect(method.$('input')).toBeDisabled();
  await browser.keys('Escape');
}

export async function openEnFaceWindowInputs(view?: WebdriverIO.Element) {
  const viewer = await enFaceView(view);
  const tool = $(WINDOW_TOOL);
  await volViewPage.closeMenu(tool);
  await volViewPage.closeMenu(viewer.$(CONTROLS));
  await viewer.$(CANVAS).waitForClickable();
  await viewer.$(CANVAS).click();
  const menu = await volViewPage.openMenu(tool);
  const inputs = await menu.$$('.manual-inputs input');
  await inputs[0].waitForDisplayed();
  await inputs[0].waitForStable();
  return inputs;
}

export async function enterEnFaceWindow(
  width: number,
  level: number,
  view?: WebdriverIO.Element
) {
  const inputs = await openEnFaceWindowInputs(view);
  // Set the center before narrowing a window that may be constrained.
  await setValueVueInput(inputs[1], String(level));
  await setValueVueInput(inputs[0], String(width));
  return inputs;
}

export async function setEnFaceWindow(
  width: number,
  level: number,
  view?: WebdriverIO.Element
) {
  const inputs = await enterEnFaceWindow(width, level, view);
  await inputs[1].click();
  await browser.waitUntil(
    async () => Number(await inputs[1].getValue()) === level,
    {
      timeoutMsg: 'The focused level field must retain its exact entered value',
    }
  );
  await inputs[0].click();
  await browser.waitUntil(
    async () => Number(await inputs[0].getValue()) === width,
    {
      timeoutMsg: 'The focused width field must retain its exact entered value',
    }
  );
  await volViewPage.closeMenu($(WINDOW_TOOL));
  await inputs[0].waitForDisplayed({ reverse: true });
}

export async function getEnFaceWindow(view?: WebdriverIO.Element) {
  const viewer = await enFaceView(view);
  const panel = $(PANEL);
  const controls = viewer.$(CONTROLS);
  const restorePanel =
    (await controls.getAttribute('aria-expanded')) === 'true';
  const sections = ['projection', 'thickness'] as const;
  const expanded = await Promise.all(
    sections.map(
      async (section) =>
        restorePanel &&
        (await panel
          .$('[data-testid="enface-' + section + '-toggle"]')
          .getAttribute('aria-expanded')) === 'true'
    )
  );
  await volViewPage.closeMenu(controls);
  if (restorePanel) await panel.waitForDisplayed({ reverse: true });
  await viewer.$(CANVAS).waitForClickable();
  const inputs = await openEnFaceWindowInputs(viewer);
  await inputs[0].click();
  const width = Number(await inputs[0].getValue());
  await inputs[1].click();
  const result = { width, level: Number(await inputs[1].getValue()) };
  await volViewPage.closeMenu($(WINDOW_TOOL));
  await inputs[0].waitForDisplayed({ reverse: true });
  if (restorePanel) {
    await volViewPage.openMenu(controls);
    // Reopening the menu renders a new panel, so look it up again.
    const reopened = $(PANEL);
    await reopened.waitForDisplayed();
    await reopened.waitForStable();
    for (const [index, section] of sections.entries()) {
      const toggle = reopened.$(
        '[data-testid="enface-' + section + '-toggle"]'
      );
      if (expanded[index]) {
        await expandEnFaceSection(section);
      } else if ((await toggle.getAttribute('aria-expanded')) === 'true') {
        await toggle.scrollIntoView({ block: 'center', inline: 'nearest' });
        await toggle.waitForClickable();
        await toggle.click();
      }
    }
    await reopened.waitForStable();
  }
  return result;
}

export async function expectEnFaceDisabledInSwitcher(reason: string) {
  const switcher = (await $$('.view-type-select .v-field'))[0];
  await switcher.click();
  const option = overlayOption('En face');
  await option.waitForDisplayed();
  expect(await option.getAttribute('class')).toContain('v-list-item--disabled');
  expect(await option.getText()).toContain('En face');
  const activator = option.$('..');
  await expect(activator).toHaveAttribute('tabindex', '0');
  await activator.execute((element) => (element as HTMLElement).focus());
  const tooltipId = await activator.getAttribute('aria-describedby');
  expect(tooltipId).toBeTruthy();
  await expect($(`[id="${tooltipId}"]`)).toHaveText(
    expect.stringContaining(reason)
  );
}

export async function projectionTransform(view?: WebdriverIO.Element) {
  const viewer = await enFaceView(view);
  const transform = await viewer
    .$('[data-testid="enface-slice-lines"] > g')
    .getAttribute('transform');
  if (!transform) throw new Error('The projection has no image transform');
  return transform.slice(7, -1).split(',').map(Number);
}

export async function expectProjectionTransform(
  expected: number[],
  view?: WebdriverIO.Element
) {
  await browser.waitUntil(async () =>
    (await projectionTransform(view)).every(
      (value, index) => Math.abs(value - expected[index]) < 1e-4
    )
  );
}

export async function attachMaskThroughDataPanel(file: string) {
  await openThroughDialog(path.join(TEMP_DIR, file));
  await $('button[data-testid="module-tab-Data"]').click();
  await waitForModuleTransitions();
  const card = $('.v-card:has([title="' + path.basename(file) + '"])');
  await card.waitForDisplayed();
  await card.waitForStable();
  const menu = card.$('button.dataset-menu');
  await menu.scrollIntoView({ block: 'center', behavior: 'instant' });
  await menu.waitForDisplayed();
  await menu.waitForStable();
  await menu.waitForClickable();
  await menu.click();
  const attach = overlayOption('Add as segmentation');
  await attach.waitForStable();
  await attach.waitForClickable();
  await attach.click();
}

/** Attaches a staged mask as a segmentation and selects one of its segments. */
export async function attachAndSelectMask(file: string, segment: string) {
  await attachMaskThroughDataPanel(file);
  await openAnnotationSegments();
  await waitForSegmentContent(segment);
  await selectSegment(segment);
}
