import type { Page } from '@playwright/test';
import { test, expect, useSharedPage } from '../fixtures';
import { PROSTATEX_DATASET } from '../datasets';
import { createVolViewPage } from '../pageobjects/volview.page';
import { createUtils } from './utils';

/**
 * The reference-line segments currently drawn, grouped by 2D view in layout
 * order. Each segment is [x1, y1, x2, y2].
 */
const getReferenceLines = (page: Page) =>
  page.evaluate(() => {
    const views = Array.from(
      document.querySelectorAll('div[data-testid~="vtk-two-view"]')
    );
    return views.map((view) =>
      Array.from(
        view.querySelectorAll('svg[data-testid="reference-lines"] line')
      ).map((element) => {
        const line = element as SVGLineElement;
        return [
          line.x1.baseVal.value,
          line.y1.baseVal.value,
          line.x2.baseVal.value,
          line.y2.baseVal.value,
        ];
      })
    );
  });

const countReferenceLines = async (page: Page) => {
  const lines = await getReferenceLines(page);
  return lines.reduce((sum, viewLines) => sum + viewLines.length, 0);
};

const waitForReferenceLineCount = (
  page: Page,
  predicate: (count: number) => boolean,
  timeoutMsg: string
) =>
  expect
    .poll(async () => predicate(await countReferenceLines(page)), {
      message: timeoutMsg,
    })
    .toBe(true);

// Must match CROSSING_GAP in src/referenceLines/ReferenceLineSegments.vue.
const CROSSING_GAP = 16;

/**
 * The distance between the facing ends of each collinear pair of pieces in a
 * view — i.e. the width of the break left where another line crosses.
 */
const collinearGaps = (viewLines: number[][]) => {
  const direction = ([x1, y1, x2, y2]: number[]) => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    return [(x2 - x1) / length, (y2 - y1) / length];
  };
  const endpoints = ([x1, y1, x2, y2]: number[]) => [
    [x1, y1],
    [x2, y2],
  ];

  const gaps: number[] = [];
  viewLines.forEach((a, indexA) => {
    viewLines.slice(indexA + 1).forEach((b) => {
      const [ax, ay] = direction(a);
      const [bx, by] = direction(b);
      if (Math.abs(ax * by - ay * bx) > 1e-3) return;
      gaps.push(
        Math.min(
          ...endpoints(a).flatMap(([px, py]) =>
            endpoints(b).map(([qx, qy]) => Math.hypot(px - qx, py - qy))
          )
        )
      );
    });
  });
  return gaps;
};

const clickToolButton = (page: Page, iconClass: string) =>
  page.locator(`button span i[class~=${iconClass}]`).click();

test.describe('Reference lines', () => {
  useSharedPage(async (page, scratch) => {
    await createUtils(page, scratch).openUrls([PROSTATEX_DATASET]);
    await createVolViewPage(page, scratch).waitForViews();
  });

  test('draws no lines by default', async ({ page }) => {
    expect(await countReferenceLines(page)).toBe(0);
  });

  test('shows lines while Crosshairs is active and hides them afterwards', async ({
    page,
  }) => {
    await clickToolButton(page, 'mdi-crosshairs');

    await waitForReferenceLineCount(
      page,
      (count) => count > 0,
      'Expected reference lines once Crosshairs was activated'
    );

    // Each 2D view draws one line per cross-axis peer, and each of those two
    // lines is broken in half by the gap where they cross.
    const lines = await getReferenceLines(page);
    expect(lines.length).toBe(3);
    lines.forEach((viewLines) => {
      expect(viewLines.length).toBe(4);
      // The two halves of each line are separated by the crossing gap.
      const gaps = collinearGaps(viewLines);
      expect(gaps.length).toBe(2);
      gaps.forEach((gap) =>
        expect(Math.abs(gap - CROSSING_GAP)).toBeLessThan(1)
      );
    });

    await clickToolButton(page, 'mdi-cursor-move');

    await waitForReferenceLineCount(
      page,
      (count) => count === 0,
      'Expected reference lines to disappear when Crosshairs was deactivated'
    );
  });

  test('keeps lines on independently of any tool when the setting is on', async ({
    page,
    referenceLines,
  }) => {
    await referenceLines.setReferenceLinesEnabled(true);

    await waitForReferenceLineCount(
      page,
      (count) => count > 0,
      'Expected reference lines from the setting alone'
    );

    // A Crosshairs session must not clear a user-enabled setting.
    await clickToolButton(page, 'mdi-crosshairs');
    await waitForReferenceLineCount(
      page,
      (count) => count > 0,
      'Expected reference lines while Crosshairs was active'
    );
    await clickToolButton(page, 'mdi-cursor-move');
    await waitForReferenceLineCount(
      page,
      (count) => count > 0,
      'Expected reference lines to survive Crosshairs deactivation'
    );
  });

  test('moves the host plane line in the peer views when the slice changes', async ({
    page,
    volview,
  }) => {
    const before = await getReferenceLines(page);
    expect(before.length).toBe(3);

    await volview.focusFirst2DView();
    await volview.advanceSliceAndWait();

    await expect
      .poll(
        async () => {
          const after = await getReferenceLines(page);
          // The scrolled view's plane moved, so its line moved in both peers.
          return [1, 2].every((viewIndex) =>
            after[viewIndex].some(
              (segment, lineIndex) =>
                JSON.stringify(segment) !==
                JSON.stringify(before[viewIndex][lineIndex])
            )
          );
        },
        {
          message:
            'Expected the scrolled view line to move in the other 2D views',
        }
      )
      .toBe(true);
  });
});
