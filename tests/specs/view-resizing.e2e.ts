import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { center, type ViewLayoutUtils } from './viewLayoutTestUtils';

const MIN_PANE_WIDTH = 160;

const createResizeHelpers = (page: Page, layout: ViewLayoutUtils) => {
  const dividers = page.locator(
    '[role="separator"][aria-label="Resize views"]'
  );
  const verticalDividers = dividers.and(
    page.locator('[aria-orientation="vertical"]')
  );

  const dragDivider = async (divider: Locator, dx: number) => {
    const from = center(await layout.bounds(divider));
    await layout.drag(from, { x: from.x + dx, y: from.y });
  };

  const waitForPaneWidth = (index: number, width: number) =>
    expect
      .poll(async () => (await layout.paneBounds(index)).width, {
        message: `Expected pane ${index} to be ${width}px wide`,
      })
      .toBeCloseTo(width, 0);

  const openDual = () =>
    layout.openLayoutFixture(
      'view-resizing',
      { Dual: [['axial', 'axial']] },
      2
    );

  const openDualPanes = async () => {
    await openDual();
    return [await layout.paneBounds(0), await layout.paneBounds(1)];
  };

  const narrowFirstPane = async () => {
    await openDual();
    const left = await layout.paneBounds(0);
    await dragDivider(verticalDividers.first(), -left.width);
    await waitForPaneWidth(0, MIN_PANE_WIDTH);
    expect((await layout.paneBounds(0)).left).toBe(left.left);
  };

  return {
    dividers,
    verticalDividers,
    dragDivider,
    waitForPaneWidth,
    openDual,
    openDualPanes,
    narrowFirstPane,
  };
};

test.describe('Resizing views', () => {
  test('moves only the two panes beside a dragged divider without remounting them', async ({
    page,
    layout,
  }) => {
    const { verticalDividers, dragDivider, waitForPaneWidth, openDualPanes } =
      createResizeHelpers(page, layout);
    const [left, right] = await openDualPanes();
    const canvases = await page.locator('canvas').count();
    await layout.markCanvases();

    await dragDivider(verticalDividers.first(), 120);
    await waitForPaneWidth(0, left.width + 120);
    const [nextLeft, nextRight] = [
      await layout.paneBounds(0),
      await layout.paneBounds(1),
    ];
    expect(nextLeft.left).toBe(left.left);
    expect(nextRight.width).toBeCloseTo(right.width - 120, 0);
    expect(nextRight.right).toBeCloseTo(right.right, 0);
    await expect(page.locator('canvas')).toHaveCount(canvases);
    await expect(layout.keptCanvases).toHaveCount(2);
  });

  test('stops a divider where a pane reaches its minimum width, keeping its controls inside', async ({
    page,
    layout,
  }) => {
    const { narrowFirstPane } = createResizeHelpers(page, layout);
    await narrowFirstPane();

    const pane = layout.panes.first();
    const lines = pane
      .locator('.annotation-cell', { has: page.locator('.slice-label') })
      .locator(':scope > *');
    await expect(lines.first()).toBeVisible();
    const fit = async () => {
      const bounds = await layout.bounds(pane);
      const controls = await layout.bounds(pane.locator('.view-controls'));
      const textRights = await Promise.all(
        (await lines.all()).map(
          async (line) => (await layout.bounds(line)).right
        )
      );
      return {
        controlsInside:
          controls.left >= bounds.left && controls.right <= bounds.right,
        textClear: textRights.every((right) => right <= controls.left),
      };
    };
    await expect.poll(fit).toEqual({ controlsInside: true, textClear: true });
  });

  test('moves the view type into View actions while a pane is narrow', async ({
    page,
    utils,
    layout,
  }) => {
    const { narrowFirstPane } = createResizeHelpers(page, layout);
    await narrowFirstPane();
    await expect(layout.panes.nth(0).locator('.view-type-select')).toHaveCount(
      0
    );
    await expect(
      layout.panes.nth(1).locator('.view-type-select')
    ).toBeAttached();

    await layout.viewAction(0, 'Coronal');
    await layout.openViewActions(0);
    await expect(utils.overlayOption('Coronal')).toHaveClass(
      /\bv-list-item--active\b/
    );

    await layout.expectCanvasPerPane();
    await layout.markCanvases();
    await layout.viewAction(0, 'Coronal');
    await layout.openViewActions(0);
    await expect(utils.overlayOption('Coronal')).toHaveClass(
      /\bv-list-item--active\b/
    );
    await expect(layout.keptCanvases).toHaveCount(2);
  });

  test('shows overlay text in full while the pane has room for it', async ({
    page,
    layout,
  }) => {
    const { verticalDividers, dragDivider, waitForPaneWidth, openDual } =
      createResizeHelpers(page, layout);
    await openDual();
    const left = await layout.paneBounds(0);
    const dx = Math.round(400 - left.width);
    await dragDivider(verticalDividers.first(), dx);
    await waitForPaneWidth(0, left.width + dx);
    const pane = layout.panes.first();
    await expect(pane).toContainText('W/L:');

    const truncated = () =>
      pane
        .locator('.annotation-cell, .annotation-cell > div')
        .evaluateAll((cells) =>
          cells
            .filter((cell) => cell.scrollWidth > cell.clientWidth)
            .map((cell) => cell.textContent?.trim())
        );
    await expect.poll(truncated).toEqual([]);
  });

  test('ignores secondary buttons and reverts a drag on Escape', async ({
    page,
    layout,
  }) => {
    const { verticalDividers, waitForPaneWidth, openDual } =
      createResizeHelpers(page, layout);
    await openDual();
    const left = await layout.paneBounds(0);
    const from = center(await layout.bounds(verticalDividers.first()));
    const to = { x: from.x + 100, y: from.y };

    await layout.drag(from, to, { button: 'right' });
    await page.keyboard.press('Escape');
    expect((await layout.paneBounds(0)).width).toBe(left.width);

    await layout.drag(from, to, { hold: true });
    await waitForPaneWidth(0, left.width + 100);
    await page.keyboard.press('Escape');
    await waitForPaneWidth(0, left.width);
    await page.mouse.up();
    expect((await layout.paneBounds(0)).width).toBe(left.width);
  });

  test('moves the Four Up cross as one', async ({
    page,
    volview,
    utils,
    layout,
  }) => {
    const { verticalDividers, dragDivider, waitForPaneWidth } =
      createResizeHelpers(page, layout);
    const image = utils.writeMetaImage('view-resizing-four-up.mha');
    await volview.open(`?urls=[tmp/${image}]`);
    await volview.waitForViews();
    await layout.waitForPaneCount(4);
    await layout.expectCanvasPerPane();
    await expect(verticalDividers).toHaveCount(2);
    const upper = await layout.paneBounds(0);

    await dragDivider(verticalDividers.first(), -150);
    await waitForPaneWidth(0, upper.width - 150);
    await waitForPaneWidth(2, upper.width - 150);
    const [top, bottom] = [
      await layout.bounds(verticalDividers.nth(0)),
      await layout.bounds(verticalDividers.nth(1)),
    ];
    expect(top.left).toBe(bottom.left);
    expect(top.bottom).toBe(bottom.top);
  });

  test('keeps resized panes in place through split, close and double-click reset', async ({
    page,
    layout,
  }) => {
    const { verticalDividers, dragDivider, waitForPaneWidth, openDualPanes } =
      createResizeHelpers(page, layout);
    const [left, right] = await openDualPanes();
    await dragDivider(verticalDividers.first(), -100);
    await waitForPaneWidth(0, left.width - 100);
    const resized = await layout.paneBounds(1);

    await layout.viewAction(1, 'Split side by side');
    await layout.waitForPaneCount(3);
    expect((await layout.paneBounds(0)).width).toBeCloseTo(left.width - 100, 0);
    expect((await layout.paneBounds(1)).width).toBeCloseTo(
      resized.width / 2,
      0
    );
    expect((await layout.paneBounds(2)).right).toBeCloseTo(resized.right, 0);

    await layout.viewAction(2, 'Close view');
    await layout.waitForPaneCount(2);
    await waitForPaneWidth(1, resized.width);
    expect((await layout.paneBounds(0)).width).toBeCloseTo(left.width - 100, 0);

    await verticalDividers.first().dblclick();
    await waitForPaneWidth(0, left.width);
    expect((await layout.paneBounds(1)).width).toBeCloseTo(right.width, 0);
    await expect(layout.panes).toHaveCount(2);
  });

  test('hides dividers while a view is maximized and restores the sizes after', async ({
    page,
    layout,
  }) => {
    const {
      dividers,
      verticalDividers,
      dragDivider,
      waitForPaneWidth,
      openDual,
    } = createResizeHelpers(page, layout);
    await openDual();
    const left = await layout.paneBounds(0);
    await dragDivider(verticalDividers.first(), 80);
    await waitForPaneWidth(0, left.width + 80);
    const resized = [await layout.paneBounds(0), await layout.paneBounds(1)];

    await layout.panes
      .nth(1)
      .locator('[data-testid~="vtk-view"] .view')
      .dblclick();
    await layout.waitForPaneCount(1);
    await expect(dividers).toHaveCount(0);

    await layout.panes
      .first()
      .locator('[data-testid~="vtk-view"] .view')
      .dblclick();
    await layout.waitForPaneCount(2);
    await expect(dividers).toHaveCount(1);
    expect(await layout.paneBounds(0)).toEqual(resized[0]);
    expect(await layout.paneBounds(1)).toEqual(resized[1]);
  });

  test('restores resized panes from a saved session', async ({
    page,
    layout,
  }) => {
    const { verticalDividers, dragDivider, waitForPaneWidth, openDual } =
      createResizeHelpers(page, layout);
    await openDual();
    const left = await layout.paneBounds(0);
    await dragDivider(verticalDividers.first(), -90);
    await waitForPaneWidth(0, left.width - 90);
    const resized = [await layout.paneBounds(0), await layout.paneBounds(1)];

    await layout.saveAndReopen(2);
    await waitForPaneWidth(0, resized[0].width);
    expect((await layout.paneBounds(1)).width).toBeCloseTo(resized[1].width, 0);
  });
});
