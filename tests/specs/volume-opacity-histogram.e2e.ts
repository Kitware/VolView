import { volViewPage } from '../pageobjects/volview.page';
import { captureViewPixels, waitForModuleTransitions } from './utils';
import {
  differingFraction,
  floatVoxels,
  nrrd,
  openWith3DLayout,
  radialRamp,
  writeNrrd,
} from './volumeTestUtils';

const SIZE = 16;
const EDITOR = '[data-testid="volume-opacity-editor"]';

const ramp = radialRamp(SIZE);
const voxels = (corner: number) =>
  floatVoxels(SIZE, (index) => (index === 0 ? corner : ramp(index)));

async function capture() {
  const [{ data }] = await captureViewPixels(
    EDITOR,
    0,
    'volume-opacity-histogram.png'
  );
  return data;
}

async function stableEditorPixels(name: string, outlier: number) {
  await openWith3DLayout(
    writeNrrd(name, nrrd([], 'float', SIZE), voxels(outlier)),
    name
  );
  await volViewPage.renderingModuleTab.waitForClickable();
  await volViewPage.renderingModuleTab.click();
  await waitForModuleTransitions();
  await $(EDITOR).scrollIntoView({ block: 'center', behavior: 'instant' });
  let previous = await capture();
  await browser.waitUntil(async () => {
    const next = await capture();
    const same = next.equals(previous);
    previous = next;
    return same;
  });
  return previous;
}

describe('3D rendering opacity editor histogram', () => {
  it('spans the fitted opacity range rather than a far outlier', async () => {
    const plain = await stableEditorPixels('opacity-histogram-plain', 0);
    const outlier = await stableEditorPixels('opacity-histogram-outlier', 1e6);
    expect(differingFraction(plain, outlier)).toBeLessThan(0.01);
  });
});
