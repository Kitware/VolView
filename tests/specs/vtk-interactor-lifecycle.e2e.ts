import { COLOR3D_JPEG_BASELINE_DICOM } from './configTestUtils';
import { openUrls } from './utils';

const VIEW_SELECTOR = 'div[data-testid="vtk-view vtk-two-view"]';
const DELETED_INSTANCE_ERROR = 'instance deleted - cannot call any method';

type BrowserLogEntry = { text: string | null };

async function captureBrowserConsoleLogsDuring(action: () => Promise<void>) {
  const logs: BrowserLogEntry[] = [];
  const handler = (entry: BrowserLogEntry) => {
    logs.push(entry);
  };

  await (browser as any).sessionSubscribe({ events: ['log.entryAdded'] });
  browser.on('log.entryAdded', handler);

  try {
    await action();
    await browser.pause(250);
  } finally {
    browser.off('log.entryAdded', handler);
  }

  return logs;
}

async function wheelFirstCineView() {
  return browser.execute((selector: string) => {
    const view = document.querySelector(selector) as HTMLElement | null;
    const container = view?.querySelector('.view') as HTMLElement | null;

    if (!view || !container) {
      return {
        ok: false,
        defaultPrevented: false,
        reason: 'missing first cine view or VTK container',
      };
    }

    const rect = container.getBoundingClientRect();
    const defaultWasNotPrevented = container.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY: 120,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      })
    );

    return {
      ok: true,
      defaultPrevented: !defaultWasNotPrevented,
    };
  }, VIEW_SELECTOR);
}

describe('VTK interactor lifecycle', () => {
  it('does not log a deleted interactor error when maximizing after wheel scroll', async () => {
    await openUrls([COLOR3D_JPEG_BASELINE_DICOM]);

    const firstView = $(VIEW_SELECTOR);
    await firstView.waitForDisplayed({ timeout: 10000 });

    const wheelState = await wheelFirstCineView();
    expect(wheelState.ok).toBe(true);
    expect(wheelState.defaultPrevented).toBe(true);

    const logs = await captureBrowserConsoleLogsDuring(async () => {
      // vtk.js debounces wheel end by 200ms, then extends animation for 600ms.
      await browser.pause(260);
      await firstView.doubleClick();
    });

    const deletedInteractorErrors = logs
      .map((entry) => entry.text ?? '')
      .filter((message) => message.includes(DELETED_INSTANCE_ERROR));

    expect(deletedInteractorErrors).toEqual([]);
  });
});
