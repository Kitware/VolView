import { startVolumeTextureFixture } from '../fixtures/volume-texture/server.mjs';

describe('Volume texture updates', () => {
  let fixture: Awaited<ReturnType<typeof startVolumeTextureFixture>>;

  before(async () => {
    fixture = await startVolumeTextureFixture();
  });

  after(async () => {
    await fixture?.close();
  });

  it('renders the complete first volume with queued updates and preserves later partial updates', async () => {
    await browser.url(fixture.url);
    const status = $('#render-status');
    await browser.waitUntil(
      async () => (await status.getText()) !== 'Preparing'
    );
    expect(await status.getText()).toBe('Rendered');
    const initial = JSON.parse(await $('#render-pixels').getText());
    for (const pixel of [initial.center, initial.edge]) {
      expect(pixel[0]).toBeGreaterThan(240);
      expect(pixel[1]).toBeLessThan(5);
      expect(pixel[2]).toBeLessThan(5);
      expect(pixel[3]).toBe(255);
    }
    expect(initial.outside).toEqual([0, 0, 0, 255]);

    await $('#update-volume').click();
    expect(await status.getText()).toBe('Rendered');
    const updated = JSON.parse(await $('#render-pixels').getText());
    expect(updated.center[0]).toBeLessThan(5);
    expect(updated.center[1]).toBeLessThan(5);
    expect(updated.center[2]).toBeGreaterThan(240);
    expect(updated.center[3]).toBe(255);
    expect(updated.edge).toEqual(initial.edge);
    expect(updated.outside).toEqual(initial.outside);
  });
});
