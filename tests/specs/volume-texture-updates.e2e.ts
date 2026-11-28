import { test, expect } from '../fixtures';
import { startVolumeTextureFixture } from '../fixtures/volume-texture/server.mjs';

test.describe('Volume texture updates', () => {
  let fixture: Awaited<ReturnType<typeof startVolumeTextureFixture>>;

  test.beforeAll(async () => {
    fixture = await startVolumeTextureFixture();
  });

  test.afterAll(async () => {
    await fixture?.close();
  });

  test('renders the complete first volume with queued updates and preserves later partial updates', async ({
    page,
  }) => {
    await page.goto(fixture.url);
    const status = page.locator('#render-status');
    await expect.poll(() => status.innerText()).not.toBe('Preparing');
    expect(await status.innerText()).toBe('Rendered');
    const pixels = page.locator('#render-pixels');
    const initial = JSON.parse(await pixels.innerText());
    for (const pixel of [initial.center, initial.edge]) {
      expect(pixel[0]).toBeGreaterThan(240);
      expect(pixel[1]).toBeLessThan(5);
      expect(pixel[2]).toBeLessThan(5);
      expect(pixel[3]).toBe(255);
    }
    expect(initial.outside).toEqual([0, 0, 0, 255]);

    await page.locator('#update-volume').click();
    expect(await status.innerText()).toBe('Rendered');
    const updated = JSON.parse(await pixels.innerText());
    expect(updated.center[0]).toBeLessThan(5);
    expect(updated.center[1]).toBeLessThan(5);
    expect(updated.center[2]).toBeGreaterThan(240);
    expect(updated.center[3]).toBe(255);
    expect(updated.edge).toEqual(initial.edge);
    expect(updated.outside).toEqual(initial.outside);
  });
});
