import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES } from '../../wdio.shared.conf';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { makeTempDir, openThroughDialog, writeManifestToFile } from './utils';
import { waitForFirstCachedImageSpacing } from './imageCacheUtils';
import {
  expectEnFacePixels,
  expectEnFaceDisabledInSwitcher,
} from './octTestUtils';

const CANVAS = '[data-testid="oct-en-face-canvas"]';
const STATE = '[data-testid="oct-en-face-state"]';
const PANEL = '[data-testid="oct-rendering-panel"]';
const FLOW_ASSETS = path.join(FIXTURES, '..', 'baseline', 'oct');
const native = JSON.parse(
  fs.readFileSync(
    path.join(FIXTURES, 'oct', 'heidelberg-reference.json'),
    'utf8'
  )
) as {
  dimensions: number[];
  spacing: number[];
  projectionSamples: {
    x: number;
    z: number;
    mean: number;
    slab100to300mean: number;
  }[];
};
const flow = JSON.parse(
  fs.readFileSync(
    path.join(FIXTURES, 'oct', 'retinal-flow-reference.json'),
    'utf8'
  )
) as {
  dimensions: number[];
  points: { x: number; z: number }[];
  threePlaneMean: number[];
};

async function waitForBitmap(width: number, height: number) {
  await $(CANVAS).waitForDisplayed();
  await browser.waitUntil(
    async () =>
      (await $(STATE).getAttribute('data-state')) === 'ready' &&
      (await $(CANVAS).getAttribute('width')) === String(width) &&
      (await $(CANVAS).getAttribute('height')) === String(height)
  );
}

async function setSlab(start: number, end: number) {
  await $('[data-testid="oct-en-face-controls"]').click();
  await $(PANEL).waitForDisplayed();
  const advanced = $('[data-testid="oct-advanced-toggle"]');
  if ((await advanced.getAttribute('aria-expanded')) !== 'true')
    await advanced.click();
  for (const [name, value] of [
    ['start', start],
    ['end', end],
  ] as const) {
    const input = $('[data-testid="oct-slab-' + name + '"] input');
    await input.scrollIntoView({ block: 'center' });
    await input.waitForClickable();
    await setValueVueInput(input, String(value));
    await $(PANEL + ' .controls-title').click();
  }
}

async function expectSuppliedEnFacePlane(url: string) {
  const result = await browser.execute(async (referenceUrl) => {
    const reference = new Image();
    reference.src = referenceUrl;
    await reference.decode();
    const copy = document.createElement('canvas');
    copy.width = reference.width;
    copy.height = reference.height;
    const context = copy.getContext('2d')!;
    context.drawImage(reference, 0, 0);
    const supplied = context.getImageData(0, 0, copy.width, copy.height).data;
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="oct-en-face-canvas"]'
    )!;
    const rendered = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    const state = document.querySelector<HTMLElement>(
      '[data-testid="oct-en-face-state"]'
    )!;
    const width = Number(state.dataset.windowWidth);
    const level = Number(state.dataset.windowLevel);
    let different = 0;
    for (let i = 0; i < supplied.length; i += 4) {
      const gray = Math.round(
        Math.min(1, Math.max(0, (supplied[i] - (level - width / 2)) / width)) *
          255
      );
      if (
        rendered[i] !== gray ||
        rendered[i + 1] !== gray ||
        rendered[i + 2] !== gray ||
        rendered[i + 3] !== 255
      )
        different++;
    }
    return { different, compared: supplied.length / 4 };
  }, url);
  expect(result.compared).toBe(304 * 304);
  expect(result.different).toBe(0);
}

describe('Public OCT exports', () => {
  it('loads the native Heidelberg DICOM from the sample browser with calibrated stacked views', async () => {
    await volViewPage.open();
    const sample = volViewPage.samplesList.$('div[title="Retinal OCT"]');
    await sample.waitForClickable();
    await sample.click();
    await waitForBitmap(native.dimensions[0], native.dimensions[2]);
    await volViewPage.waitForViewCounts(1, false);
    const spacing = await waitForFirstCachedImageSpacing();
    spacing.forEach((value, axis) =>
      expect(value).toBeCloseTo(native.spacing[axis], 6)
    );
    await expectEnFacePixels(
      native.projectionSamples.map((p) => p.mean),
      native.projectionSamples
    );
    await volViewPage.openLayoutMenu();
    expect(
      await $('[data-testid="oct-layout"]').getAttribute('class')
    ).toContain('v-list-item--active');
    await volViewPage.layoutButton.click();
    await setSlab(100, 300);
    await expectEnFacePixels(
      native.projectionSamples.map((p) => p.slab100to300mean),
      native.projectionSamples
    );
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('preserves the allowed customer layout when sample defaults contain a disabled view type', async () => {
    for (const disabled of ['2D', 'EnFace']) {
      const configName = 'oct-disable-' + disabled + '.json';
      await writeManifestToFile(
        {
          layouts: { 'Allowed volume': [['volume']] },
          disabledViewTypes: [disabled],
        },
        configName
      );
      await volViewPage.open('?urls=[tmp/' + configName + ']');
      await volViewPage.waitForViewCounts(0, true);
      const sample = volViewPage.samplesList.$('div[title="Retinal OCT"]');
      await sample.waitForClickable();
      await sample.click();
      await waitForFirstCachedImageSpacing();
      await volViewPage.openLayoutMenu();
      expect(
        await $('[data-testid="oct-layout"]').getAttribute('class')
      ).toContain('v-list-item--disabled');
      await volViewPage.waitForViewCounts(0, true);
      expect(await $(CANVAS).isExisting()).toBe(false);
      expect(await $('.view-type-select input').getValue()).toBe('Volume');
      await browser.keys('Escape');
      if (disabled === 'EnFace') {
        await expectEnFaceDisabledInSwitcher('configuration disables En face');
        await browser.keys('Escape');
      }
      expect(await volViewPage.getNotificationsCount()).toBe(0);
    }
  });
  it('matches every pixel of a supplied OCTA en face plane through manual NRRD selection', async () => {
    const directory = makeTempDir('oct-external-reference');
    for (const name of ['retinal-flow.nrrd', 'retinal-flow-source.png'])
      fs.copyFileSync(path.join(FLOW_ASSETS, name), path.join(directory, name));
    await volViewPage.open();
    await openThroughDialog(path.join(directory, 'retinal-flow.nrrd'));
    await volViewPage.waitForViews();
    await (await $$('.view-type-select .v-field'))[0].click();
    const option = $(
      '//div[contains(@class, "v-overlay--active")]//div[contains(@class, "v-list-item") and normalize-space(.)="En face"]'
    );
    await option.waitForClickable();
    await option.click();
    await waitForBitmap(flow.dimensions[0], flow.dimensions[2]);
    await expectEnFacePixels(flow.threePlaneMean, flow.points);
    await setSlab(1, 1);
    await expect($('[data-testid="oct-thin-highlight"] input')).toBeDisabled();
    await browser.waitUntil(
      async () =>
        (await $(STATE).getAttribute('data-slab-start')) === '1' &&
        (await $(STATE).getAttribute('data-slab-end')) === '1' &&
        (await $(STATE).getAttribute('data-state')) === 'ready'
    );
    await expectSuppliedEnFacePlane(
      '/tmp/oct-external-reference/retinal-flow-source.png'
    );
    if (process.env.OCT_EVIDENCE_DIR) {
      fs.mkdirSync(process.env.OCT_EVIDENCE_DIR, { recursive: true });
      const pixels = await browser.execute(
        (selector) =>
          document
            .querySelector<HTMLCanvasElement>(selector)!
            .toDataURL('image/png'),
        CANVAS
      );
      fs.writeFileSync(
        path.join(process.env.OCT_EVIDENCE_DIR, 'supplied-enface.png'),
        Buffer.from(pixels.split(',')[1], 'base64')
      );
    }
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
