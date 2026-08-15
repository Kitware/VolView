import { PROSTATEX_DATASET } from './configTestUtils';
import { openUrls } from './utils';
import { volViewPage } from '../pageobjects/volview.page';

const SETTING_LABEL = 'label*=Reference Lines';

/**
 * The reference-line segments currently drawn, grouped by 2D view in layout
 * order. Each segment is [x1, y1, x2, y2].
 */
const getReferenceLines = () =>
  browser.execute(() => {
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

const countReferenceLines = async () => {
  const lines = await getReferenceLines();
  return lines.reduce((sum, viewLines) => sum + viewLines.length, 0);
};

const waitForReferenceLineCount = async (
  predicate: (count: number) => boolean,
  timeoutMsg: string
) => {
  await browser.waitUntil(async () => predicate(await countReferenceLines()), {
    timeoutMsg,
  });
};

// Must match CROSSING_GAP in src/referenceLines/ReferenceLines.vue.
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

const clickToolButton = async (iconClass: string) => {
  const button = await $(`button span i[class~=${iconClass}]`);
  await button.waitForClickable();
  await button.click();
};

const setReferenceLinesSetting = async (on: boolean) => {
  const settingsButton = await $(
    'button[data-testid="control-button-Settings"]'
  );
  await settingsButton.waitForClickable();
  await settingsButton.click();

  const label = await $(SETTING_LABEL);
  await label.waitForClickable();
  const isOn = (await label.getText()).includes('On');
  if (isOn !== on) {
    await label.click();
    await browser.waitUntil(
      async () =>
        (await $(SETTING_LABEL).getText()).includes(on ? 'On' : 'Off'),
      { timeoutMsg: `Reference Lines switch did not turn ${on ? 'on' : 'off'}` }
    );
  }

  await browser.keys(['Escape']);
  await browser.waitUntil(async () => !(await $(SETTING_LABEL).isExisting()), {
    timeoutMsg: 'Settings dialog did not close',
  });
};

describe('Reference lines', () => {
  before(async () => {
    await openUrls([PROSTATEX_DATASET]);
    await volViewPage.waitForViews();
  });

  after(async () => {
    // The setting is browser-level, so leave the profile as we found it.
    await setReferenceLinesSetting(false);
  });

  it('draws no lines by default', async () => {
    expect(await countReferenceLines()).toBe(0);
  });

  it('shows lines while Crosshairs is active and hides them afterwards', async () => {
    await clickToolButton('mdi-crosshairs');

    await waitForReferenceLineCount(
      (count) => count > 0,
      'Expected reference lines once Crosshairs was activated'
    );

    // Each 2D view draws one line per cross-axis peer, and each of those two
    // lines is broken in half by the gap where they cross.
    const lines = await getReferenceLines();
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

    await clickToolButton('mdi-cursor-move');

    await waitForReferenceLineCount(
      (count) => count === 0,
      'Expected reference lines to disappear when Crosshairs was deactivated'
    );
  });

  it('keeps lines on independently of any tool when the setting is on', async () => {
    await setReferenceLinesSetting(true);

    await waitForReferenceLineCount(
      (count) => count > 0,
      'Expected reference lines from the setting alone'
    );

    // A Crosshairs session must not clear a user-enabled setting.
    await clickToolButton('mdi-crosshairs');
    await waitForReferenceLineCount(
      (count) => count > 0,
      'Expected reference lines while Crosshairs was active'
    );
    await clickToolButton('mdi-cursor-move');
    await waitForReferenceLineCount(
      (count) => count > 0,
      'Expected reference lines to survive Crosshairs deactivation'
    );
  });

  it('moves the host plane line in the peer views when the slice changes', async () => {
    const before = await getReferenceLines();
    expect(before.length).toBe(3);

    await volViewPage.focusFirst2DView();
    await volViewPage.advanceSliceAndWait();

    await browser.waitUntil(
      async () => {
        const after = await getReferenceLines();
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
        timeoutMsg:
          'Expected the scrolled view line to move in the other 2D views',
      }
    );
  });
});
