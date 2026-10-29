import { volViewPage } from '../pageobjects/volview.page';
import { makeTempDir, writeManifestToFile, overlayOption } from './utils';
import {
  canvasAppearance,
  displayedWindow,
  dragContrast,
  stageGenericOCT,
} from './octTestUtils';

const WINDOW_TOOL = 'button[data-testid^="control-button-Window & Level "]';
const OBLIQUE_CHILD =
  '.oblique-grid > .d-flex:first-child [data-testid="vtk-view"]';
const SOURCE_PEER = '[data-testid~="vtk-two-view"]';

describe('Oblique source windowing', () => {
  it('synchronizes a live Oblique child drag with source peers and toolbar fields', async () => {
    const directory = 'oblique-windowing';
    const image = stageGenericOCT(makeTempDir(directory), 'nrrd');
    await writeManifestToFile(
      { windowing: { width: 1000, level: 500 } },
      directory + '-config.json'
    );
    await volViewPage.open(
      '?urls=[tmp/' +
        directory +
        '/' +
        image +
        ',tmp/' +
        directory +
        '-config.json]'
    );
    await volViewPage.waitForViews();
    await volViewPage.waitForViewCounts(3, true);
    await (await $$('.view-type-select .v-field'))[0].click();
    const option = overlayOption('Oblique');
    await option.waitForClickable();
    await option.click();

    const child = await $(OBLIQUE_CHILD).getElement();
    const canvas = await child.$('canvas').getElement();
    await canvas.waitForClickable();
    const peer = await $(SOURCE_PEER).getElement();
    const peerCanvas = await peer.$('canvas').getElement();
    await browser.waitUntil(
      async () => (await canvasAppearance(peerCanvas)).visiblePixels > 100,
      { timeoutMsg: 'The scalar source peer must render visible image pixels' }
    );
    const before = await displayedWindow(child);
    expect(before).toEqual({ width: 1000, level: 500 });
    const beforeImage = (await canvasAppearance(peerCanvas)).image;
    await $(WINDOW_TOOL).click();
    await browser.keys('Escape');
    await $('.v-overlay--active .manual-inputs input').waitForDisplayed({
      reverse: true,
    });
    await dragContrast(canvas, 35, 25, { position: { x: 0.25, y: 0.25 } });
    let observed = before;
    await browser
      .waitUntil(
        async () => {
          observed = await displayedWindow(child);
          return (
            observed.width !== before.width && observed.level !== before.level
          );
        },
        {
          timeoutMsg:
            'The live Oblique child must respond to the windowing drag',
        }
      )
      .catch((error: Error) => {
        error.message +=
          '; initial ' +
          JSON.stringify(before) +
          '; observed ' +
          JSON.stringify(observed);
        throw error;
      });
    const changed = await displayedWindow(child);
    await browser.waitUntil(
      async () => {
        const synchronized = await displayedWindow(peer);
        return (
          synchronized.width === changed.width &&
          synchronized.level === changed.level
        );
      },
      {
        timeoutMsg:
          'The source peer must match the live Oblique child W/L ' +
          JSON.stringify(changed),
      }
    );
    await browser.waitUntil(
      async () => (await canvasAppearance(peerCanvas)).image !== beforeImage,
      {
        timeoutMsg:
          'Synchronized windowing must change the source image rendering',
      }
    );

    await $(WINDOW_TOOL).click();
    const inputs = $$('.v-overlay--active .manual-inputs input');
    await inputs[0].waitForDisplayed();
    expect(Number(await inputs[0].getValue())).toBeCloseTo(changed.width, 2);
    expect(Number(await inputs[1].getValue())).toBeCloseTo(changed.level, 2);
  });
});
