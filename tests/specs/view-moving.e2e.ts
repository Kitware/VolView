import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { exactText } from '../pageobjects/volview.page';
import { center, type ViewLayoutUtils } from './viewLayoutTestUtils';

const expectNear = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThan(1);

const createMoveHelpers = (page: Page, layout: ViewLayoutUtils) => {
  const preview = page.locator('.layout-drop-preview');

  const paneOf = (type: string) =>
    layout.panes.filter({
      has: page.locator('.v-select__selection-text', {
        hasText: exactText(type),
      }),
    });

  const boundsOf = (type: string) => layout.bounds(paneOf(type));

  const boundsByType = async () => {
    const [Axial, Coronal, Sagittal, Volume] = await Promise.all(
      ['Axial', 'Coronal', 'Sagittal', 'Volume'].map(boundsOf)
    );
    return { Axial, Coronal, Sagittal, Volume };
  };

  const dragView = async (
    type: string,
    to: { x: number; y: number },
    options?: { hold: boolean }
  ) => {
    const handle = paneOf(type).locator('button[aria-label="Move view"]');
    await layout.drag(center(await layout.bounds(handle)), to, options);
  };

  const openQuad = () =>
    layout.openLayoutFixture(
      'view-moving',
      {
        Quad: [
          ['axial', 'coronal'],
          ['sagittal', 'volume'],
        ],
      },
      4
    );

  return { preview, boundsOf, boundsByType, dragView, openQuad };
};

test.describe('Moving views', () => {
  test('docks a dragged view beside the edge it is dropped on, keeping renderers', async ({
    page,
    layout,
  }) => {
    const { boundsOf, boundsByType, dragView, openQuad } = createMoveHelpers(
      page,
      layout
    );
    await openQuad();
    await layout.markCanvases();
    const before = await boundsByType();
    const volume = before.Volume;

    await dragView('Axial', {
      x: Math.round(volume.left + volume.width - 10),
      y: Math.round(volume.top + volume.height / 2),
    });

    await expect
      .poll(async () =>
        Math.abs((await boundsOf('Coronal')).left - before.Axial.left)
      )
      .toBeLessThan(1);
    const after = await boundsByType();
    expectNear(after.Coronal.width, before.Axial.width * 2);
    expectNear(after.Axial.top, volume.top);
    expectNear(
      after.Axial.left + after.Axial.width,
      volume.left + volume.width
    );
    expectNear(after.Volume.left, volume.left);
    expectNear(after.Volume.width, volume.width / 2);
    expectNear(after.Sagittal.width, before.Sagittal.width);
    await expect(layout.keptCanvases).toHaveCount(4);
  });

  test('swaps two views when one is dropped on the middle of the other', async ({
    page,
    layout,
  }) => {
    const { boundsOf, boundsByType, dragView, openQuad } = createMoveHelpers(
      page,
      layout
    );
    await openQuad();
    const before = await boundsByType();
    const sagittal = before.Sagittal;

    await dragView('Coronal', center(sagittal));

    await expect
      .poll(async () =>
        Math.abs((await boundsOf('Coronal')).top - sagittal.top)
      )
      .toBeLessThan(1);
    const after = await boundsByType();
    expect(after.Coronal).toEqual(sagittal);
    expect(after.Sagittal).toEqual(before.Coronal);
    expect(after.Axial).toEqual(before.Axial);
  });

  test('leaves the layout alone when the drag is canceled with Escape', async ({
    page,
    layout,
  }) => {
    const { preview, boundsByType, dragView, openQuad } = createMoveHelpers(
      page,
      layout
    );
    await openQuad();
    const before = await boundsByType();
    const sagittal = before.Sagittal;

    await dragView('Coronal', center(sagittal), { hold: true });
    await expect(preview).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();
    await page.mouse.up();

    await layout.waitForPaneCount(4);
    expect(await boundsByType()).toEqual(before);
  });
});
