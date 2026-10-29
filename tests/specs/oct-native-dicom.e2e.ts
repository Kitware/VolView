import fs from 'node:fs';
import path from 'node:path';
import { JHU_RETINAL_LAYERS, RETINAL_OCT_DICOM } from '../datasets';
import { volViewPage } from '../pageobjects/volview.page';
import { useCachedSample, writeManifestToFile, overlayOption } from './utils';
import native from '../fixtures/oct/heidelberg-reference.json';
import { waitForFirstCachedImageSpacing } from './imageCacheUtils';
import {
  canvasAppearance,
  dragContrast,
  expectEnFaceDisabledInSwitcher,
  expandEnFaceSection,
  setSlabRange,
  enFaceAppearance,
  waitForEnFaceReady,
  displayedWindow,
  selectEnFace,
  selectTwoRowLayout,
  CANVAS,
  PANEL,
  CONTROLS,
} from './octTestUtils';
import {
  openAnnotationSegments,
  segmentNames,
  waitForSegmentContent,
} from './segmentationTestUtils';

async function canvasImage(view: WebdriverIO.Element) {
  const source = await view.$('canvas').getElement();
  return canvasAppearance(source);
}

async function openNativeDicom() {
  await volViewPage.open('?urls=[tmp/' + RETINAL_OCT_DICOM.name + ']');
  await volViewPage.waitForViews();
  await waitForFirstCachedImageSpacing();
  await selectTwoRowLayout();
  await volViewPage.waitForViewCounts(2, false);
  await selectEnFace(1);
  await waitForEnFaceReady();
  await volViewPage.waitForViewCounts(1, false);
}

async function setSlab(start: number, end: number) {
  await $('[data-testid="enface-controls"]').click();
  await $(PANEL).waitForDisplayed();
  await expandEnFaceSection('projection');
  await setSlabRange(start, end);
}

describe('Public OCT exports', () => {
  before(() => useCachedSample(JHU_RETINAL_LAYERS));

  it('loads retinal layers from a ZIP URL or sample card and projects the volume on request', async () => {
    const names = [
      'Retinal nerve fiber layer (RNFL)',
      'Ganglion cell and inner plexiform layers (GCL+IPL)',
      'Inner nuclear layer (INL)',
      'Outer plexiform layer (OPL)',
      'Outer nuclear layer (ONL)',
      'Photoreceptor inner segments (IS)',
      'Photoreceptor outer segments (OS)',
      'Retinal pigment epithelium (RPE)',
    ];
    for (const fromSample of [false, true]) {
      await volViewPage.open(
        fromSample ? '/' : '?urls=[tmp/' + JHU_RETINAL_LAYERS.name + ']'
      );
      await volViewPage.waitForViewCounts(3, true);
      if (fromSample) {
        const sample = volViewPage.samplesList.$(
          'div[title="Retinal OCT layers"]'
        );
        await sample.waitForClickable();
        await expect(
          volViewPage.samplesList.$('div[title="Retinal OCT"]')
        ).not.toExist();
        await sample.click();
      }
      await volViewPage.waitForViews();
      await expect(
        $('.image-list-card:has([title="jhu-hc01.nrrd"])')
      ).toHaveElementClass('image-list-card-active');
      await openAnnotationSegments();
      await waitForSegmentContent(names[7]);
      expect(await segmentNames()).toEqual(names);
      await volViewPage.waitForViewCounts(3, true);
      expect(
        await $$('.view-type-select input').map((input) => input.getValue())
      ).toEqual(['Axial', 'Coronal', 'Sagittal', 'Volume']);
      expect(await $(CANVAS).isExisting()).toBe(false);
      await browser.waitUntil(async () =>
        browser.execute(() => {
          const source = document.querySelector<HTMLCanvasElement>(
            'div[data-testid~="vtk-two-view"] canvas'
          )!;
          const copy = document.createElement('canvas');
          copy.width = source.width;
          copy.height = source.height;
          const context = copy.getContext('2d')!;
          context.drawImage(source, 0, 0);
          const pixels = context.getImageData(
            0,
            0,
            copy.width,
            copy.height
          ).data;
          let colored = 0;
          for (let i = 0; i < pixels.length; i += 4)
            if (
              Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
                Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >
              40
            )
              colored++;
          return colored > 200;
        })
      );
      expect(await volViewPage.getNotificationsCount()).toBe(0);
    }

    await (await $$('.view-type-select .v-field'))[1].click();
    await overlayOption('En face').waitForClickable();
    await overlayOption('En face').click();
    await waitForEnFaceReady();
    await $(CONTROLS).click();
    await $(PANEL).waitForDisplayed();
    await $(PANEL).waitForStable();
    await expect($('[data-testid="enface-projection-toggle"]')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expandEnFaceSection('projection');
    const axis = $('.v-overlay--active [data-testid="enface-projection-axis"]');
    await axis.scrollIntoView({ block: 'center' });
    await axis.waitForClickable();
    await axis.click();
    await overlayOption('Coronal').waitForClickable();
    await overlayOption('Coronal').click();
    const captureDirectory = process.env.VOLVIEW_OCT_CAPTURE_DIR;
    if (captureDirectory) {
      fs.mkdirSync(captureDirectory, { recursive: true });
      await browser.saveScreenshot(
        path.join(captureDirectory, 'jhu-en-face-controls.png')
      );
    }
    await browser.keys('Escape');
    await waitForEnFaceReady();
  });

  it('keeps source contrast and pixels when replacing an independently windowed projection', async () => {
    await openNativeDicom();
    if (
      ((await $('#left-nav').getAttribute('class')) ?? '').includes(
        'v-navigation-drawer--active'
      )
    )
      await $('header .mdi-menu').click();
    const source = await (await volViewPage.getViews2D())[0].getElement();
    const windowTool = $(
      'button[data-testid^="control-button-Window & Level "]'
    );
    if (
      !((await windowTool.getAttribute('class')) ?? '').includes(
        'tool-btn-selected'
      )
    )
      await windowTool.click();
    await source.$('canvas').waitForStable();
    const initialWindow = await displayedWindow(source);
    const initialImage = await canvasImage(source);
    await source.$('canvas').waitForClickable();
    await dragContrast(await source.$('canvas').getElement(), 65, 45);
    await browser.waitUntil(async () => {
      const window = await displayedWindow(source);
      return (
        window.width !== initialWindow.width &&
        window.level !== initialWindow.level &&
        (await canvasImage(source)).image !== initialImage.image
      );
    });
    const projectionBefore = await $(CANVAS).execute((element) =>
      (element as HTMLCanvasElement).toDataURL()
    );
    await $(CANVAS).waitForStable();
    await dragContrast(await $(CANVAS).getElement(), -50, 40);
    await browser.waitUntil(
      async () =>
        (await $(CANVAS).execute((element) =>
          (element as HTMLCanvasElement).toDataURL()
        )) !== projectionBefore
    );
    const beforeWindow = await displayedWindow(source);
    const beforeImage = await canvasImage(source);
    // Require over 1000 actual pixels with at least one RGB channel above 20.
    expect(beforeImage.visiblePixels).toBeGreaterThan(1000);
    await $('[data-testid="enface-viewer"] .view-type-select .v-field').click();
    const axial = overlayOption('Axial');
    await axial.waitForClickable();
    await axial.click();
    await $(CANVAS).waitForExist({ reverse: true });
    await volViewPage.waitForViewCounts(2, false);
    const replacement = await (await volViewPage.getViews2D())[1].getElement();
    await browser.waitUntil(
      async () => (await canvasImage(replacement)).visiblePixels > 1000
    );
    expect(await displayedWindow(source)).toEqual(beforeWindow);
    expect(await displayedWindow(replacement)).toEqual(beforeWindow);
    expect((await canvasImage(source)).image).toBe(beforeImage.image);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
  it('loads the native Heidelberg DICOM fixture with calibrated stacked views', async () => {
    await openNativeDicom();
    const spacing = await waitForFirstCachedImageSpacing();
    spacing.forEach((value, axis) =>
      expect(value).toBeCloseTo(native.spacing[axis], 6)
    );
    const fullProjection = await enFaceAppearance();
    await setSlab(100, 300);
    await browser.waitUntil(
      async () => (await enFaceAppearance()).image !== fullProjection.image
    );
    await waitForEnFaceReady();
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('preserves the configured volume layout when loading retinal layers with disabled view types', async () => {
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
      const sample = volViewPage.samplesList.$(
        'div[title="Retinal OCT layers"]'
      );
      await sample.waitForClickable();
      await sample.click();
      await waitForFirstCachedImageSpacing();
      await volViewPage.waitForViewCounts(0, true);
      expect(await $(CANVAS).isExisting()).toBe(false);
      expect(await $('.view-type-select input').getValue()).toBe('Volume');
      if (disabled === 'EnFace') {
        await expectEnFaceDisabledInSwitcher('configuration disables En face');
        await browser.keys('Escape');
      }
      expect(await volViewPage.getNotificationsCount()).toBe(0);
    }
  });
});
