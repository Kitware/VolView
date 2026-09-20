import { startOutlineFixture } from '../fixtures/label-outline/server.mjs';

// Exercise the installed vtk.js shader in real WebGL. A DOM unit test cannot
// detect CLAMP_TO_EDGE turning an out-of-image neighbor into the same label.
describe('Bounded label outlines', () => {
  let fixture: Awaited<ReturnType<typeof startOutlineFixture>>;

  before(async () => {
    fixture = await startOutlineFixture();
  });

  after(async () => {
    await fixture?.close();
  });

  for (const axis of [0, 1, 2]) {
    it(`outlines all four cropped edges on axis ${axis}`, async () => {
      await browser.url(`${fixture.url}?axis=${axis}`);
      await browser.waitUntil(() =>
        browser.execute(() => !!window.outlineResult)
      );
      const result = await browser.execute(() => window.outlineResult);
      for (const edge of ['left', 'right', 'bottom', 'top'] as const) {
        expect(result[edge]).toBeGreaterThan(240);
      }
      expect(result.center).toBe(51);
      expect(result.innerEdge).toBe(51);
      expect(result.outside).toBe(0);
    });
  }

  it('does not invent background at the scan boundary', async () => {
    await browser.url(`${fixture.url}?axis=2&scanEdge`);
    await browser.waitUntil(() =>
      browser.execute(() => !!window.outlineResult)
    );
    const result = await browser.execute(() => window.outlineResult);
    expect(result.right).toBe(51);
    for (const edge of ['left', 'bottom', 'top'] as const) {
      expect(result[edge]).toBeGreaterThan(240);
    }
  });

  it('matches the original full-grid mask with and without scan truncation', async () => {
    for (const scanEdge of ['', '&scanEdge']) {
      const results = [];
      for (const fullGrid of ['', '&fullGrid']) {
        await browser.url(`${fixture.url}?axis=2${scanEdge}${fullGrid}`);
        await browser.waitUntil(() =>
          browser.execute(() => !!window.outlineResult)
        );
        results.push(await browser.execute(() => window.outlineResult));
      }
      expect(results[0]).toEqual(results[1]);
    }
  });

  it('keeps edges after repeated thickness and opacity updates', async () => {
    await browser.url(`${fixture.url}?axis=2`);
    await browser.waitUntil(() =>
      browser.execute(() => !!window.outlineResult)
    );
    const highlighted = await browser.execute(() => window.renderOutline(5));
    expect(highlighted.innerEdge).toBeGreaterThan(240);
    const faded = await browser.execute(() => window.renderOutline(3, 0.5));
    expect(faded.left).toBeGreaterThan(120);
    expect(faded.left).toBeLessThan(135);
    const disabled = await browser.execute(() => window.renderOutline(0));
    expect(disabled.left).toBe(51);
    const restored = await browser.execute(() => window.renderOutline(3));
    expect(restored.left).toBeGreaterThan(240);
    expect(restored.innerEdge).toBe(51);
    expect(restored.center).toBe(51);
  });

  it('refreshes the reused texture after erasing and repainting the whole mask', async () => {
    await browser.url(`${fixture.url}?axis=2`);
    await browser.waitUntil(() =>
      browser.execute(() => !!window.outlineResult)
    );
    const original = await browser.execute(() => window.outlineResult);
    const erased = await browser.execute(() => window.editMask(0));
    expect(Object.values(erased).every((value) => value === 0)).toBe(true);
    const repainted = await browser.execute(() => window.editMask(1));
    expect(repainted).toEqual(original);
  });
});
