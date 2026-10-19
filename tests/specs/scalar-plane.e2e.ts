import fs from 'node:fs';
import path from 'node:path';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { makeTempDir } from './utils';
import {
  enFacePixel,
  expandEnFaceSection,
  waitForEnFaceReady,
} from './octTestUtils';
import { createSyntheticOCT } from '../fixtures/oct/dicom';
import { paddedSyntheticOCT } from '../fixtures/oct/padding';

const CANVAS = '[data-testid="oct-en-face-canvas"]';
const WINDOW_TOOL = 'button[data-testid^="control-button-Window & Level "]';
const STEM = 'scalar-plane';

type Upload = {
  width: number;
  height: number;
  components: number;
};
type ProbeWindow = Window & {
  scalarPlaneProbe: {
    workers: number;
    uploads: Upload[];
    floatLinearDenied: number;
  };
};

async function installRenderingProbe() {
  await browser.addInitScript(() => {
    const probe = {
      workers: 0,
      uploads: [] as Upload[],
      floatLinearDenied: 0,
    };
    (window as unknown as ProbeWindow).scalarPlaneProbe = probe;
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        probe.workers += 1;
        return Reflect.construct(target, args);
      },
    });
    for (const context of [
      WebGLRenderingContext.prototype,
      WebGL2RenderingContext.prototype,
    ]) {
      const getExtension = context.getExtension;
      Object.defineProperty(context, 'getExtension', {
        value: function (this: WebGLRenderingContext, name: string) {
          // Nearest scalar rendering must retain Float32 precision even when
          // the browser cannot linearly filter Float32 textures.
          if (name === 'OES_texture_float_linear') {
            probe.floatLinearDenied += 1;
            return null;
          }
          return Reflect.apply(getExtension, this, [name]);
        },
      });
      for (const name of ['texImage2D', 'texSubImage2D'] as const) {
        const original = context[name];
        Object.defineProperty(context, name, {
          value: function (this: WebGLRenderingContext, ...args: unknown[]) {
            const offset = name === 'texImage2D' ? 3 : 4;
            probe.uploads.push({
              width: Number(args[offset]),
              height: Number(args[offset + 1]),
              components: args[6] === this.RGBA ? 4 : 1,
            });
            return Reflect.apply(original, this, args);
          },
        });
      }
    }
  });
}

async function renderingCounts(width: number, height: number) {
  return browser.execute(
    (w, h) => {
      const probe = (window as unknown as ProbeWindow).scalarPlaneProbe;
      // Child views share the parent's GL context; texture dimensions identify
      // the plane without assuming its presentation canvas owns that context.
      const uploads = probe.uploads.filter(
        (upload) => upload.width === w && upload.height === h
      );
      return {
        workers: probe.workers,
        scalarUploads: uploads.filter((upload) => upload.components === 1)
          .length,
        overlayUploads: uploads.filter((upload) => upload.components === 4)
          .length,
      };
    },
    width,
    height
  );
}

function stageFloatVolume(
  name: string,
  value: (x: number, y: number, z: number) => number
) {
  const dimensions = [16, 4, 8];
  const header = [
    'NRRD0005',
    'type: float',
    'dimension: 3',
    'sizes: ' + dimensions.join(' '),
    'space: left-posterior-superior',
    'space directions: (0.03,0,0) (0,0.01,0) (0,0,0.06)',
    'space units: "mm" "mm" "mm"',
    'space origin: (0,0,0)',
    'endian: little',
    'encoding: raw',
    '',
    '',
  ].join('\n');
  const voxels = Buffer.alloc(dimensions.reduce((a, b) => a * b) * 4);
  for (let z = 0; z < dimensions[2]; z++)
    for (let y = 0; y < dimensions[1]; y++)
      for (let x = 0; x < dimensions[0]; x++)
        voxels.writeFloatLE(
          value(x, y, z),
          ((z * dimensions[1] + y) * dimensions[0] + x) * 4
        );
  fs.writeFileSync(
    path.join(makeTempDir(STEM), name),
    Buffer.concat([Buffer.from(header), voxels])
  );
  return STEM + '/' + name;
}

async function openEnFace(file: string) {
  await volViewPage.open('?urls=[tmp/' + file + ']');
  await volViewPage.waitForViews();
  if (!(await $(CANVAS).isExisting())) {
    await (await $$('.view-type-select .v-field'))[0].click();
    const option = $(
      '//div[contains(@class,"v-overlay--active")]//div[contains(@class,"v-list-item") and normalize-space(.)="En face"]'
    );
    await option.waitForClickable();
    await option.click();
  }
  await waitForEnFaceReady();
  expect(
    await browser.execute(
      () =>
        (window as unknown as ProbeWindow).scalarPlaneProbe.floatLinearDenied
    )
  ).toBeGreaterThan(0);
}

async function setWindow(width: number, level: number) {
  await browser.keys('Escape');
  await $(CANVAS).click();
  await $(WINDOW_TOOL).click();
  const inputs = $$('.v-overlay--active .manual-inputs input');
  await inputs[0].waitForDisplayed();
  await inputs[0].waitForStable();
  await setValueVueInput(inputs[0], String(width));
  await setValueVueInput(inputs[1], String(level));
  await browser.waitUntil(
    async () =>
      Number(await inputs[0].getValue()) === width &&
      Number(await inputs[1].getValue()) === level,
    {
      timeoutMsg:
        'Manual fields must retain the exact entered window and level',
    }
  );
  await browser.keys('Escape');
  await inputs[0].waitForDisplayed({ reverse: true });
}

async function expectGray(x: number, y: number, gray: number) {
  let observed: number[] = [];
  await browser
    .waitUntil(
      async () => {
        const pixel = await enFacePixel(x, y);
        observed = pixel;
        return (
          pixel[3] === 255 &&
          pixel.slice(0, 3).every((channel) => Math.abs(channel - gray) <= 1)
        );
      },
      {
        timeoutMsg: `Expected derived pixel (${x}, ${y}) to be grayscale ${gray}`,
      }
    )
    .catch((error: Error) => {
      error.message += `; observed RGBA ${observed.join(',')}`;
      throw error;
    });
}

async function chooseProjection(testId: string, label: string) {
  await $('[data-testid="oct-en-face-controls"]').click();
  await expandEnFaceSection('projection');
  const select = $('[data-testid="' + testId + '"]');
  await select.scrollIntoView({ block: 'center', inline: 'nearest' });
  await select.waitForClickable();
  await select.click();
  const option = $(
    '//div[contains(@class,"v-overlay--active")]//div[contains(@class,"v-list-item") and normalize-space(.)="' +
      label +
      '"]'
  );
  await option.waitForClickable();
  await option.click();
  await browser.keys('Escape');
  await waitForEnFaceReady();
}

describe('Scalar derived image rendering', () => {
  before(installRenderingProbe);

  it('centers a high constant Float32 image in its automatic window', async () => {
    await openEnFace(stageFloatVolume('constant.nrrd', () => 1e9));
    await expectGray(4, 3, 128);
    await setWindow(128, 1e9 + 64);
    await expectGray(4, 3, 0);
    await setWindow(128, 1e9 - 64);
    await expectGray(4, 3, 255);
  });

  it('preserves fractional means and sums with physical pixel aspect', async () => {
    await openEnFace(
      stageFloatVolume('fractional.nrrd', (x, y, z) => x / 8 + y / 16 + z / 32)
    );
    await setWindow(2, 1);
    await expectGray(4, 3, 88);
    await expectGray(12, 3, 215);
    const aspect = await browser.execute(() => {
      const matrix = document
        .querySelector<SVGGElement>('[data-testid="oct-slice-lines"] g')!
        .getScreenCTM()!;
      return Math.hypot(matrix.a, matrix.b) / Math.hypot(matrix.c, matrix.d);
    });
    expect(aspect).toBeCloseTo(0.5, 5);
    await chooseProjection('oct-projection-method', 'Sum');
    await setWindow(8, 4);
    await expectGray(4, 3, 88);
    await expectGray(12, 3, 215);
    await chooseProjection('oct-projection-method', 'Mean');
    await chooseProjection('oct-projection-axis', 'Z (frames)');
    await setWindow(2, 1);
    // Mean z contributes 3.5/32; the new plane's y coordinate is source y.
    await expectGray(4, 2, 94);
  });

  it('retains a finite sample at the midpoint of an extremely narrow manual window', async () => {
    await openEnFace(
      stageFloatVolume('narrow.nrrd', (x, y, z) => x / 8 + y / 16 + z / 32)
    );
    await setWindow(1e-12, 0.6875);
    await expectGray(4, 3, 128);
    await expectGray(3, 3, 0);
    await expectGray(5, 3, 255);
  });

  it('preserves small Float32 distinctions across a mixed-sign intensity range', async () => {
    await openEnFace(
      stageFloatVolume('mixed-range.nrrd', (x) =>
        x === 0 ? -1 : x === 1 ? 0 : x === 2 ? 1e-8 : 1
      )
    );
    await setWindow(2e-8, 0);
    await expectGray(1, 3, 128);
    await expectGray(2, 3, 255);
    await expectGray(0, 3, 0);
  });

  it('preserves a manual center between adjacent high-valued Float32 samples', async () => {
    await openEnFace(
      stageFloatVolume('high-adjacent.nrrd', (x) =>
        x === 1 ? 99999992 : x === 2 ? 100000000 : 1
      )
    );
    await setWindow(8, 99999996);
    await expectGray(1, 3, 0);
    await expectGray(2, 3, 255);
  });

  it('keeps padding black without projection workers or plane uploads during window changes', async () => {
    const { bytes, mean, points } = paddedSyntheticOCT(createSyntheticOCT());
    fs.writeFileSync(path.join(makeTempDir(STEM), 'padding.dcm'), bytes);
    await openEnFace(STEM + '/padding.dcm');
    await setWindow(1000, 500);
    await expectGray(
      points[0].x,
      points[0].z,
      Math.round((mean[0] * 255) / 1000)
    );
    await expectGray(5, 12, 0);
    const before = await renderingCounts(128, 32);
    expect(before.scalarUploads).toBeGreaterThan(0);
    expect(before.overlayUploads).toBeGreaterThan(0);
    console.log(
      'Scalar plane initial rendering counters:',
      JSON.stringify(before)
    );
    expect(before.workers).toBeGreaterThan(0);
    await setWindow(1000, -500);
    await expectGray(points[0].x, points[0].z, 255);
    await expectGray(5, 12, 0);
    expect(await renderingCounts(128, 32)).toEqual(before);
    await setWindow(1000, 1500);
    await expectGray(points[0].x, points[0].z, 0);
    await expectGray(5, 12, 0);
    const after = await renderingCounts(128, 32);
    console.log(
      'Scalar plane rendering counters after window changes:',
      JSON.stringify(after)
    );
    expect(after).toEqual(before);
  });
});
