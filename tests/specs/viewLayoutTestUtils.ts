import { expect, type Locator, type Page } from '@playwright/test';
import { createVolViewPage } from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import { createUtils } from './utils';

type Point = { x: number; y: number };
type Rect = { left: number; top: number; width: number; height: number };

const DISABLED_ITEM = /\bv-list-item--disabled\b/;

export const center = ({ left, top, width, height }: Rect) => ({
  x: Math.round(left + width / 2),
  y: Math.round(top + height / 2),
});

export const createViewLayoutUtils = (page: Page, scratch: Scratch) => {
  const volview = createVolViewPage(page, scratch);
  const utils = createUtils(page, scratch);
  const panes = page.locator('.grid-item');
  const typeLabels = panes.locator('.v-select__selection-text');
  const keptCanvases = page.locator('.grid-item canvas[data-kept]');

  const waitForPaneCount = (count: number) => expect(panes).toHaveCount(count);

  const bounds = async (locator: Locator) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Expected the element to be on screen');
    return {
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height,
      width: box.width,
      height: box.height,
    };
  };

  const paneBounds = (index: number) => bounds(panes.nth(index));

  const paneTypes = async () =>
    (await typeLabels.allTextContents()).map((text) => text.trim());

  /** Presses at `from` and moves to `to`; `hold` leaves the button down. */
  const drag = async (
    from: Point,
    to: Point,
    {
      button = 'left',
      hold = false,
    }: { button?: 'left' | 'right'; hold?: boolean } = {}
  ) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button });
    await page.mouse.move(to.x, to.y);
    if (!hold) await page.mouse.up({ button });
  };

  const openViewActions = (index: number) =>
    volview.openMenu(
      panes.nth(index).locator('button[aria-label="Split or close view"]')
    );

  const viewAction = async (index: number, title: string) => {
    await openViewActions(index);
    await utils.overlayOption(title).click();
  };

  const expectMenuItemDisabled = async (title: string, disabled = true) => {
    const item = utils.overlayOption(title);
    await expect(item).toBeVisible();
    if (disabled) await expect(item).toHaveClass(DISABLED_ITEM);
    else await expect(item).not.toHaveClass(DISABLED_ITEM);
  };

  /** The reason a disabled menu item's tooltip gives on hover. */
  const expectMenuItemReason = async (title: string, reason: string) => {
    // A disabled item takes no pointer events, so hover its wrapper.
    await utils.moveToElement(utils.overlayOption(title).locator('..'));
    await expect(
      page.locator('.v-tooltip.v-overlay--active .v-overlay__content')
    ).toHaveText(reason);
  };

  const expectCanvasPerPane = () =>
    expect
      .poll(
        () =>
          panes.evaluateAll((items) =>
            items.every((pane) => pane.querySelectorAll('canvas').length === 1)
          ),
        { message: 'Expected exactly one rendered canvas in every pane' }
      )
      .toBe(true);

  /** Tags the current canvases so `keptCanvases` finds the ones not remounted. */
  const markCanvases = () =>
    page.locator('.grid-item canvas').evaluateAll((canvases) =>
      canvases.forEach((canvas) => {
        (canvas as HTMLElement).dataset.kept = 'true';
      })
    );

  const openLayoutFixture = async (
    name: string,
    layouts: Record<string, unknown>,
    paneCount: number
  ) => {
    const image = utils.writeMetaImage(`${name}.mha`);
    await utils.writeManifestToFile({ layouts }, `${name}.json`);
    await volview.open(`?urls=[tmp/${image},tmp/${name}.json]`);
    await volview.waitForViews();
    await waitForPaneCount(paneCount);
    await expectCanvasPerPane();
  };

  const saveAndReopen = async (paneCount: number) => {
    const session = await volview.saveSession();
    await volview.open(`?urls=[tmp/${session}]`);
    await volview.waitForViews();
    await waitForPaneCount(paneCount);
    await expectCanvasPerPane();
  };

  return {
    panes,
    typeLabels,
    keptCanvases,
    waitForPaneCount,
    bounds,
    paneBounds,
    paneTypes,
    drag,
    openViewActions,
    viewAction,
    expectMenuItemDisabled,
    expectMenuItemReason,
    expectCanvasPerPane,
    markCanvases,
    openLayoutFixture,
    saveAndReopen,
  };
};

export type ViewLayoutUtils = ReturnType<typeof createViewLayoutUtils>;
