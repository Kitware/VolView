import { volViewPage } from '../pageobjects/volview.page';

describe('Browser without a WebGL2 context', () => {
  let noWebGL2: Awaited<ReturnType<typeof browser.addInitScript>> | undefined;

  after(async () => {
    await noWebGL2?.remove();
  });

  it('tells the user WebGL2 is unavailable', async () => {
    noWebGL2 = await browser.addInitScript(() => {
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

    await volViewPage.open();
    await volViewPage.waitForNotification();
    expect(await volViewPage.getNotificationTitles()).toEqual([
      'WebGL2 is unavailable',
    ]);
  });
});
