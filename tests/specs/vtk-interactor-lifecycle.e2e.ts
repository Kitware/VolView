import type { ConsoleMessage, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { COLOR3D_JPEG_BASELINE_DICOM } from '../datasets';

const VIEW_SELECTOR = 'div[data-testid="vtk-view vtk-cine-view"]';
const DELETED_INSTANCE_ERROR = 'instance deleted - cannot call any method';

type BrowserLogEntry = { text: string | null };

async function captureBrowserConsoleLogsDuring(
  page: Page,
  action: () => Promise<void>
) {
  const logs: BrowserLogEntry[] = [];
  const onConsole = (message: ConsoleMessage) => {
    logs.push({ text: message.text() });
  };
  const onPageError = (error: Error) => {
    logs.push({ text: error.stack ?? String(error) });
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  try {
    await action();
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }

  return logs;
}

async function wheelFirstCineView(page: Page) {
  return page.evaluate((selector: string) => {
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

test.describe('VTK interactor lifecycle', () => {
  test('does not log a deleted interactor error when maximizing after wheel scroll', async ({
    page,
    utils,
  }) => {
    // The test drives the page's timers, so the race does not depend on speed.
    await page.clock.install();
    await utils.openUrls([COLOR3D_JPEG_BASELINE_DICOM]);

    const firstView = page.locator(VIEW_SELECTOR).first();
    await expect(firstView).toBeVisible();

    const wheelState = await wheelFirstCineView(page);
    expect(wheelState.ok).toBe(true);
    expect(wheelState.defaultPrevented).toBe(true);

    const logs = await captureBrowserConsoleLogsDuring(page, async () => {
      // vtk.js debounces wheel end by 200ms, then extends animation for 600ms.
      await page.clock.runFor(260);
      await firstView.dblclick();
      await page.clock.runFor(1000);
    });

    const deletedInteractorErrors = logs
      .map((entry) => entry.text ?? '')
      .filter((message) => message.includes(DELETED_INSTANCE_ERROR));

    expect(deletedInteractorErrors).toEqual([]);
  });
});
