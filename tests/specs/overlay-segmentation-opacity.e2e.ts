import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  openAnnotationSegments,
  waitForSegmentContent,
} from './segmentationTestUtils';
import {
  capture2DViewPixels,
  selectLayout,
  writeManifestToFile,
} from './utils';

const writeImages = () => {
  const header = [
    'NRRD0005',
    'type: unsigned char',
    'dimension: 3',
    'sizes: 16 16 16',
    'space: left-posterior-superior',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: ascii',
  ];
  // The viewed plane is white underneath a black overlay. The corner voxel
  // preserves a nonzero scalar range without appearing on that plane.
  for (const [name, value] of [
    ['opacity-base.nrrd', 255],
    ['opacity-base.layer.nrrd', 0],
  ] as const) {
    const pixels = Array.from({ length: 4096 }, (_, i) =>
      i === 0 ? 255 - value : value
    ).join(' ');
    writeFileSync(join(TEMP_DIR, name), `${header.join('\n')}\n\n${pixels}`);
  }
  const mask = Array.from({ length: 4096 }, (_, index) => {
    const i = index % 16;
    const j = Math.floor(index / 16) % 16;
    const k = Math.floor(index / 256);
    return i >= 4 && i <= 11 && j >= 4 && j <= 11 && k >= 4 && k <= 11 ? 1 : 0;
  }).join(' ');
  writeFileSync(
    join(TEMP_DIR, 'opacity-base.seg.nrrd'),
    `${header.join('\n')}\nSegment0_LabelValue:=1\nSegment0_Name:=Blue mask\nSegment0_Color:=0 0 1\n\n${mask}`
  );
};

const captureSlice = async (fileName: string) =>
  (await capture2DViewPixels(80, fileName))[0].data;

describe('Overlay opacity with segmentation', () => {
  it('keeps segmentation colors continuous when opacity reaches 100%', async () => {
    writeImages();
    await writeManifestToFile(
      {
        io: { segmentationExtension: 'seg', layerExtension: 'layer' },
        windowing: { width: 255, level: 127.5 },
      },
      'opacity-config.json'
    );
    await volViewPage.open(
      '?urls=[tmp/opacity-config.json,tmp/opacity-base.nrrd,tmp/opacity-base.seg.nrrd,tmp/opacity-base.layer.nrrd]'
    );
    await volViewPage.waitForViews();
    await selectLayout('Axial Only', 1, false);
    await openAnnotationSegments();
    await waitForSegmentContent('Blue mask');
    await volViewPage.renderingModuleTab.click();
    const transparent = $('[data-testid="layer-transparent-background"] input');
    await expect(transparent).toBeChecked();
    await transparent.scrollIntoView({ block: 'center', behavior: 'instant' });
    await transparent.click();
    await expect(transparent).not.toBeChecked();
    const opacity = $('[data-testid="layer-opacity-slider"] [role="slider"]');
    await opacity.scrollIntoView({ block: 'center', behavior: 'instant' });
    await opacity.execute((element) => element.focus());
    await browser.keys(['End']);
    await browser.keys(['ArrowLeft']);
    await expect(
      $('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.99');
    await $('header').moveTo();
    await browser.execute(async () => {
      const transitions = document
        .getAnimations()
        .filter((animation) =>
          Number.isFinite(animation.effect?.getComputedTiming().endTime)
        );
      await Promise.allSettled(
        transitions.map((animation) => animation.finished)
      );
    });
    await $('[data-testid~="vtk-two-view"]').waitForStable();
    let below: number[] = [];
    let background: number[] = [];
    await browser.waitUntil(
      async () => {
        below = await captureSlice('overlay-opacity-99.png');
        background = [];
        let blue = 0;
        for (let i = 0; i < below.length; i += 4) {
          if (
            below[i + 1] >= 2 &&
            below[i + 1] <= 3 &&
            below[i + 1] === below[i + 2] &&
            below[i] - below[i + 1] <= 16
          )
            background.push(i);
          if (below[i + 2] > below[i] + 40) blue++;
        }
        return background.length > 1000 && blue > 100;
      },
      {
        timeoutMsg:
          'Expected a blue segmentation and 1% of the white base beneath the black overlay',
      }
    );
    await opacity.execute((element) => element.focus());
    await browser.keys('End');
    await expect(
      $('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '1');
    await expect($('[data-testid="layer-opacity-slider"] input')).toHaveValue(
      '1'
    );
    await $('header').moveTo();
    // At full opacity the white base contributes nothing. Requiring the
    // background's green and blue channels to reach zero excludes a stale
    // 99% frame, even when the controls update before the next render.
    await browser.waitUntil(
      async () => {
        const full = await captureSlice('overlay-opacity-100.png');
        return (
          full.length === below.length &&
          background.every(
            (index) => full[index + 1] === 0 && full[index + 2] === 0
          ) &&
          full.every((value, index) => Math.abs(value - below[index]) <= 4)
        );
      },
      {
        timeoutMsg:
          'Expected 99% to 100% opacity to preserve segmentation colors without a render-pass jump',
      }
    );
  });
});
