import { test, expect } from '../fixtures';

test.describe('Browser without a WebGL2 context', () => {
  test('tells the user WebGL2 is unavailable', async ({ page, volview }) => {
    await page.addInitScript(() => {
      const { getContext } = HTMLCanvasElement.prototype;
      HTMLCanvasElement.prototype.getContext = function refuseWebGL2(
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl2') return null;
        return (getContext as (...args: unknown[]) => unknown).call(
          this,
          type,
          ...rest
        );
      } as typeof getContext;
    });

    await volview.open();
    await volview.waitForNotification();
    expect(await volview.getNotificationTitles()).toEqual([
      'WebGL2 is unavailable',
    ]);
  });
});
