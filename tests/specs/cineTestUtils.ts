import { Key } from 'webdriverio';

export const CINE_VIEW_SELECTOR = 'div[data-testid="vtk-view vtk-cine-view"]';
export const FRAME_LABEL_SELECTOR = '.view-annotations .frame-label';

export const getCineFrame = async () => {
  const text = (await $(FRAME_LABEL_SELECTOR).getText()).trim();
  const match = text.match(/^Frame:\s*(\d+)\s*\/\s*\d+/);
  return match ? parseInt(match[1], 10) : null;
};

export const waitForFrame = async (expected: number) => {
  await browser.waitUntil(async () => (await getCineFrame()) === expected, {
    timeoutMsg: `Expected cine frame to reach ${expected}`,
  });
};

const stepCineFrame = (key: string, label: string) => async () => {
  const before = await getCineFrame();
  await browser.keys([key]);
  await browser.waitUntil(
    async () => {
      const now = await getCineFrame();
      return now !== null && now !== before;
    },
    { timeoutMsg: `Cine frame counter did not ${label}` }
  );
};

export const advanceCineFrame = stepCineFrame(Key.ArrowUp, 'advance');
export const retreatCineFrame = stepCineFrame(Key.ArrowDown, 'retreat');

export const countCineRulerLines = () =>
  browser.execute((selector: string) => {
    const view = document.querySelector(selector);
    return view ? view.querySelectorAll('svg line').length : -1;
  }, CINE_VIEW_SELECTOR);

export const getCineCanvasCenter = async () => {
  const view = await $(CINE_VIEW_SELECTOR);
  const canvas = await view.$('canvas');
  const loc = await canvas.getLocation();
  const size = await canvas.getSize();
  return {
    cx: loc.x + size.width / 2,
    cy: loc.y + size.height / 2,
  };
};

export const clickAt = (x: number, y: number) =>
  browser
    .action('pointer')
    .move({ x: Math.round(x), y: Math.round(y) })
    .down()
    .up()
    .perform();
