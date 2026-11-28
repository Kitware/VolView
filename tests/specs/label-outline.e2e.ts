import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { startOutlineFixture } from '../fixtures/label-outline/server.mjs';

const waitForOutline = (page: Page) =>
  expect.poll(() => page.evaluate(() => !!window.outlineResult)).toBe(true);

// Exercise the installed vtk.js shader in real WebGL. A DOM unit test cannot
// detect CLAMP_TO_EDGE turning an out-of-image neighbor into the same label.
test.describe('Bounded label outlines', () => {
  let fixture: Awaited<ReturnType<typeof startOutlineFixture>>;

  test.beforeAll(async () => {
    fixture = await startOutlineFixture();
  });

  test.afterAll(async () => {
    await fixture?.close();
  });

  for (const axis of [0, 1, 2]) {
    test(`outlines all four cropped edges on axis ${axis}`, async ({
      page,
    }) => {
      await page.goto(`${fixture.url}?axis=${axis}`);
      await waitForOutline(page);
      const result = await page.evaluate(() => window.outlineResult);
      for (const edge of ['left', 'right', 'bottom', 'top'] as const) {
        expect(result[edge]).toBeGreaterThan(240);
      }
      expect(result.center).toBe(51);
      expect(result.innerEdge).toBe(51);
      expect(result.outside).toBe(0);
    });
  }

  test('does not invent background at the scan boundary', async ({ page }) => {
    await page.goto(`${fixture.url}?axis=2&scanEdge`);
    await waitForOutline(page);
    const result = await page.evaluate(() => window.outlineResult);
    expect(result.right).toBe(51);
    for (const edge of ['left', 'bottom', 'top'] as const) {
      expect(result[edge]).toBeGreaterThan(240);
    }
  });

  test('matches the original full-grid mask with and without scan truncation', async ({
    page,
  }) => {
    for (const scanEdge of ['', '&scanEdge']) {
      const results = [];
      for (const fullGrid of ['', '&fullGrid']) {
        await page.goto(`${fixture.url}?axis=2${scanEdge}${fullGrid}`);
        await waitForOutline(page);
        results.push(await page.evaluate(() => window.outlineResult));
      }
      expect(results[0]).toEqual(results[1]);
    }
  });

  test('keeps edges after repeated thickness and opacity updates', async ({
    page,
  }) => {
    await page.goto(`${fixture.url}?axis=2`);
    await waitForOutline(page);
    const highlighted = await page.evaluate(() => window.renderOutline(5));
    expect(highlighted.innerEdge).toBeGreaterThan(240);
    const faded = await page.evaluate(() => window.renderOutline(3, 0.5));
    expect(faded.left).toBeGreaterThan(120);
    expect(faded.left).toBeLessThan(135);
    const disabled = await page.evaluate(() => window.renderOutline(0));
    expect(disabled.left).toBe(51);
    const restored = await page.evaluate(() => window.renderOutline(3));
    expect(restored.left).toBeGreaterThan(240);
    expect(restored.innerEdge).toBe(51);
    expect(restored.center).toBe(51);
  });

  test('refreshes the reused texture after erasing and repainting the whole mask', async ({
    page,
  }) => {
    await page.goto(`${fixture.url}?axis=2`);
    await waitForOutline(page);
    const original = await page.evaluate(() => window.outlineResult);
    const erased = await page.evaluate(() => window.editMask(0));
    expect(Object.values(erased).every((value) => value === 0)).toBe(true);
    const repainted = await page.evaluate(() => window.editMask(1));
    expect(repainted).toEqual(original);
  });

  test('colors every byte label in one plane without blending a neighbor', async ({
    page,
  }) => {
    await page.goto(`${fixture.url}?axis=2`);
    await waitForOutline(page);
    const result = await page.evaluate(() => window.renderAllLabels());
    expect(result.planes).toBe(1);
    expect(result.mismatches).toEqual([]);
  });
});
