import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { Utils } from './utils';
import { center, type ViewLayoutUtils } from './viewLayoutTestUtils';

const CANVASES_ONLY =
  '.grid-item * { visibility: hidden !important; } .grid-item canvas { visibility: visible !important; }';

const near = (a: number, b: number) => Math.abs(a - b) <= 2;

const createSplitHelpers = ({
  page,
  volview,
  utils,
  layout,
}: {
  page: Page;
  volview: VolViewPage;
  utils: Utils;
  layout: ViewLayoutUtils;
}) => {
  const { panes } = layout;

  // Rendered image width in each pane, with overlays hidden.
  const imageWidths = async (fileName: string) => {
    const style = await page.addStyleTag({ content: CANVASES_ONLY });
    try {
      const views = await utils.captureViewPixels(
        '.grid-item canvas',
        2,
        fileName
      );
      return views.map(({ width, data }) => {
        const height = data.length / 4 / width;
        const columns = Array.from({ length: width }, (_, x) =>
          Array.from({ length: height }, (__, y) => (y * width + x) * 4).some(
            (offset) =>
              Math.max(data[offset], data[offset + 1], data[offset + 2]) > 10
          )
        );
        return columns.lastIndexOf(true) - columns.indexOf(true) + 1;
      });
    } finally {
      await style.evaluate((element) => (element as Element).remove());
    }
  };

  const openLayoutFixture = () =>
    layout.openLayoutFixture(
      'view-layouts',
      {
        Quad: [
          ['axial', 'coronal'],
          ['sagittal', 'volume'],
        ],
        Single: [['axial']],
      },
      4
    );

  const openSplitFixture = () =>
    layout.openLayoutFixture(
      'view-splitting',
      { Dual: [['axial', 'axial']] },
      2
    );

  const paneOverlay = async (index: number) => {
    const text = (await panes.nth(index).textContent()) ?? '';
    return [
      text.match(/Slice:\s*\d+\/\d+/)?.[0],
      text.match(/W\/L:\s*\S+\s*\/\s*\S+/)?.[0],
    ].join(' ');
  };

  const pickLayout = async (name: string, paneCount: number) => {
    await volview.openLayoutMenu(2);
    await volview.selectLayoutOption(name);
    await volview.closeMenu(volview.layoutButton);
    await layout.waitForPaneCount(paneCount);
    await layout.expectCanvasPerPane();
  };

  const dragFromPaneCenter = async (index: number, dx: number, dy: number) => {
    const from = center(await layout.paneBounds(index));
    await layout.drag(from, { x: from.x + dx, y: from.y + dy });
  };

  const changeSlice = async (index: number) => {
    const before = await paneOverlay(index);
    await panes.nth(index).locator('canvas').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => paneOverlay(index)).not.toBe(before);
  };

  const selectViewType = async (index: number, name: string) => {
    await panes.nth(index).locator('.view-type-select .v-field').click();
    await utils.overlayOption(name).click();
    await expect(
      panes.nth(index).locator('.v-select__selection-text')
    ).toHaveText(name);
  };

  return {
    imageWidths,
    openLayoutFixture,
    openSplitFixture,
    paneOverlay,
    pickLayout,
    dragFromPaneCenter,
    changeSlice,
    selectViewType,
  };
};

test.describe('Splitting individual views', () => {
  test('retains existing renderers and image settings through nested splits and closes', async ({
    page,
    volview,
    utils,
    layout,
  }) => {
    const { openSplitFixture } = createSplitHelpers({
      page,
      volview,
      utils,
      layout,
    });
    await openSplitFixture();
    const overview = await layout.paneBounds(0);
    await layout.markCanvases();
    const sourceSlice = await layout.panes
      .nth(1)
      .locator('.slice-label')
      .innerText();
    await layout.viewAction(1, 'Split top and bottom');
    await layout.waitForPaneCount(3);
    expect(await layout.paneBounds(0)).toEqual(overview);
    await expect(layout.panes.nth(2).locator('.slice-label')).toHaveText(
      sourceSlice
    );
    await expect(layout.keptCanvases).toHaveCount(2);

    await layout.viewAction(2, 'Split side by side');
    await layout.waitForPaneCount(4);
    expect(await layout.paneBounds(0)).toEqual(overview);
    await expect(layout.keptCanvases).toHaveCount(2);

    await layout.viewAction(2, 'Close view');
    await layout.waitForPaneCount(3);
    expect(await layout.paneBounds(0)).toEqual(overview);
    await expect(layout.keptCanvases).toHaveCount(2);
    await expect(layout.panes.nth(2).locator('.slice-label')).toHaveText(
      sourceSlice
    );

    for (let cycle = 0; cycle < 3; cycle++) {
      await layout.viewAction(
        0,
        cycle % 2 ? 'Split top and bottom' : 'Split side by side'
      );
      await layout.waitForPaneCount(4);
      await layout.viewAction(1, 'Close view');
      await layout.waitForPaneCount(3);
    }
    await expect(layout.keptCanvases).toHaveCount(2);
  });

  test('preserves manually adjusted zoom when the split renderer mounts and resizes', async ({
    page,
    volview,
    utils,
    layout,
  }) => {
    const { imageWidths, openSplitFixture, dragFromPaneCenter } =
      createSplitHelpers({ page, volview, utils, layout });
    await openSplitFixture();
    await volview.selectTool('mdi-magnify-plus-outline');
    await dragFromPaneCenter(1, 0, 60);
    await expect
      .poll(async () => {
        const [fitted, zoomed] = await imageWidths('zoom-adjusted.png');
        return zoomed < fitted * 0.9;
      })
      .toBe(true);

    // The unzoomed pane, split alike, shows what refitting would draw.
    await layout.viewAction(1, 'Split top and bottom');
    await layout.waitForPaneCount(3);
    await layout.viewAction(0, 'Split top and bottom');
    await layout.waitForPaneCount(4);
    await expect
      .poll(
        async () => {
          const [fitted, fittedCopy, source, split] =
            await imageWidths('zoom-split.png');
          return (
            near(fitted, fittedCopy) &&
            near(source, split) &&
            source < fitted * 0.9
          );
        },
        { message: 'Expected both split panes to keep the adjusted zoom' }
      )
      .toBe(true);
  });

  test('starts a picked named layout over with fresh views of the image', async ({
    page,
    volview,
    utils,
    layout,
  }) => {
    const { openLayoutFixture, changeSlice, paneOverlay, pickLayout } =
      createSplitHelpers({ page, volview, utils, layout });
    await openLayoutFixture();
    await changeSlice(1);
    const coronal = await paneOverlay(1);
    await layout.viewAction(0, 'Close view');
    await layout.waitForPaneCount(3);
    await layout.markCanvases();

    await pickLayout('Quad', 4);
    await expect(layout.typeLabels).toHaveText([
      'Axial',
      'Coronal',
      'Sagittal',
      'Volume',
    ]);
    await expect(layout.keptCanvases).toHaveCount(0);
    await expect.poll(() => paneOverlay(1)).toMatch(/Slice:/);
    expect(await paneOverlay(1)).not.toBe(coronal);
  });

  test('renders one canvas per pane through split, close and layout cycles', async ({
    page,
    volview,
    utils,
    layout,
  }) => {
    const { openLayoutFixture, pickLayout } = createSplitHelpers({
      page,
      volview,
      utils,
      layout,
    });
    await openLayoutFixture();
    const canvases = page.locator('canvas');
    const outsidePanes = (await canvases.count()) - 4;
    for (let cycle = 0; cycle < 3; cycle++) {
      await layout.viewAction(0, 'Split side by side');
      await layout.waitForPaneCount(5);
      await layout.expectCanvasPerPane();
      await pickLayout('Single', 1);
      await pickLayout('Quad', 4);
      await layout.viewAction(1, 'Close view');
      await layout.waitForPaneCount(3);
      await layout.expectCanvasPerPane();
      await pickLayout('Quad', 4);
      await expect(canvases).toHaveCount(outsidePanes + 4);
    }
  });

  test('changes a split pane view type without touching its neighbors', async ({
    page,
    volview,
    utils,
    layout,
  }) => {
    const { openLayoutFixture, changeSlice, paneOverlay, selectViewType } =
      createSplitHelpers({ page, volview, utils, layout });
    await openLayoutFixture();
    await layout.viewAction(0, 'Split side by side');
    await layout.waitForPaneCount(5);
    await changeSlice(0);
    const neighbors = [0, 2, 3];
    const before = await Promise.all(neighbors.map(paneOverlay));
    await layout.markCanvases();

    await selectViewType(1, 'Sagittal');
    await layout.expectCanvasPerPane();
    await expect(layout.typeLabels).toHaveText([
      'Axial',
      'Sagittal',
      'Coronal',
      'Sagittal',
      'Volume',
    ]);
    expect(await Promise.all(neighbors.map(paneOverlay))).toEqual(before);
    await expect(layout.keptCanvases).toHaveCount(4);
  });

  test('restores split panes from a saved session', async ({
    page,
    volview,
    utils,
    layout,
  }) => {
    const { openLayoutFixture, changeSlice, paneOverlay } = createSplitHelpers({
      page,
      volview,
      utils,
      layout,
    });
    await openLayoutFixture();
    await layout.viewAction(1, 'Split top and bottom');
    await layout.waitForPaneCount(5);
    await changeSlice(2);
    const types = await layout.paneTypes();
    const overlays = await Promise.all([0, 1, 2].map(paneOverlay));

    await layout.saveAndReopen(5);
    await expect(layout.typeLabels).toHaveText(types);
    await expect
      .poll(() => Promise.all([0, 1, 2].map(paneOverlay)))
      .toEqual(overlays);
  });
});
