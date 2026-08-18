import { type ChainablePromiseElement } from 'webdriverio';
import AppPage from '../pageobjects/volview.page';
import { MINIMAL_DICOM } from './configTestUtils';
import { openUrls } from './utils';

const pointerAt = (x: number, y: number) =>
  browser.action('pointer').move({ x: Math.round(x), y: Math.round(y) });

export const moveTo = (x: number, y: number) => pointerAt(x, y).perform();

export const clickAt = (x: number, y: number) =>
  pointerAt(x, y).down().up().perform();

export const rightClickAt = (x: number, y: number) =>
  pointerAt(x, y).down({ button: 2 }).up({ button: 2 }).perform();

/**
 * Loads the minimal DICOM and returns the axial view with the center of its
 * canvas in page coordinates.
 */
export const setupTest = async () => {
  await openUrls([MINIMAL_DICOM]);

  const views2D = await AppPage.getViews2D();
  const axialView = views2D[0];
  const canvas = await axialView.$('canvas');
  const [location, size] = await Promise.all([
    canvas.getLocation(),
    canvas.getSize(),
  ]);

  return {
    axialView,
    centerX: location.x + size.width / 2,
    centerY: location.y + size.height / 2,
  };
};

// Handles of placed annotations
export const getCircleCount = async (axialView: ChainablePromiseElement) => {
  const circles = await axialView.$$('svg circle');
  return circles.length;
};

export const waitForCircleCount = async (
  axialView: ChainablePromiseElement,
  expected: number,
  timeoutMsg: string
) => {
  await browser.waitUntil(
    async () => (await getCircleCount(axialView)) === expected,
    { timeout: 5000, timeoutMsg }
  );
};
