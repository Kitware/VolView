import fs from 'node:fs';
import path from 'node:path';
import { createNrrdVolume } from '../fixtures/oct/volumes';
import { volViewPage } from '../pageobjects/volview.page';
import {
  chooseEnFaceProjection,
  expandEnFaceSection,
  setEnFaceWindow,
  setSlabRange,
  waitForEnFaceReady,
  VIEWER,
} from './octTestUtils';
import { makeTempDir, writeManifestToFile } from './utils';

const STEM = 'slab-orientation';
const SOURCE = '[data-testid~="vtk-two-view"] canvas';
const cosine = Math.cos(Math.PI / 9);
const sine = Math.sin(Math.PI / 9);
const frames = [
  {
    name: 'identity',
    direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    axes: ['Sagittal', 'Coronal', 'Axial'],
  },
  {
    name: 'rotated-permutation',
    direction: [0, cosine, sine, 0, -sine, cosine, -1, 0, 0],
    axes: ['Coronal', 'Axial', 'Sagittal'],
  },
];

async function stage(axis: number, frame: (typeof frames)[number]) {
  const axes = [0, 1, 2].filter((candidate) => candidate !== axis);
  const dimensions = [1, 1, 1];
  dimensions[axis] = 96;
  dimensions[axes[0]] = 12;
  dimensions[axes[1]] = 10;
  const scalars = Uint16Array.from(
    { length: dimensions.reduce((total, size) => total * size) },
    (_, index) => {
      const point = [
        index % dimensions[0],
        Math.floor(index / dimensions[0]) % dimensions[1],
        Math.floor(index / (dimensions[0] * dimensions[1])),
      ];
      const x = point[axes[0]];
      const y = point[axes[1]];
      if (x >= 2 && x <= 3 && y >= 2 && y <= 3) return 60;
      if (x >= 8 && x <= 9 && y >= 2 && y <= 3) return 120;
      if (x >= 2 && x <= 3 && y >= 6 && y <= 7) return 180;
      if (x >= 8 && x <= 9 && y >= 6 && y <= 7) return 240;
      return 20;
    }
  );
  fs.writeFileSync(
    path.join(makeTempDir(STEM), 'source.nrrd'),
    createNrrdVolume({
      scalars,
      dimensions,
      spacing: [0.7, 1.1, 1.6],
      origin: [19, -25, 7],
      direction: frame.direction,
    })
  );
  await writeManifestToFile(
    {
      layouts: {
        Orientation: [[frame.axes[axis].toLowerCase(), 'enface']],
      },
    },
    STEM + '.json'
  );
  await volViewPage.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/source.nrrd]`);
  await waitForEnFaceReady();
}

function markerFrame(selector: string) {
  return browser.execute((canvasSelector) => {
    const canvas = document.querySelector<HTMLCanvasElement>(canvasSelector)!;
    const capture = document.createElement('canvas');
    capture.width = canvas.width;
    capture.height = canvas.height;
    const context = capture.getContext('2d')!;
    context.drawImage(canvas, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const visited = new Uint8Array(canvas.width * canvas.height);
    const foreground = (index: number) =>
      pixels[index * 4 + 3] === 255 && pixels[index * 4] > 10;
    function componentAt(first: number) {
      const pending = [first];
      const marker = { x: 0, y: 0, count: 0, peak: 0 };
      while (pending.length) {
        const index = pending.pop()!;
        if (visited[index] || !foreground(index)) continue;
        visited[index] = 1;
        const x = index % canvas.width;
        const y = Math.floor(index / canvas.width);
        marker.x += x;
        marker.y += y;
        marker.count++;
        marker.peak = Math.max(marker.peak, pixels[index * 4]);
        const neighbors = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < canvas.width && ny >= 0 && ny < canvas.height)
            pending.push(ny * canvas.width + nx);
        }
      }
      return marker;
    }
    const markers = [];
    for (let index = 0; index < visited.length; index++) {
      if (!visited[index] && foreground(index))
        markers.push(componentAt(index));
    }
    // Separate regions retain their identities under linear or nearest sampling.
    const landmarks = markers
      .filter((marker) => marker.count >= 20)
      .sort((a, b) => a.peak - b.peak);
    if (landmarks.length !== 4) return null;
    const [a, b, c] = landmarks.map((marker) => [
      marker.x / marker.count,
      marker.y / marker.count,
    ]);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [
      (b[0] - a[0]) / length,
      (b[1] - a[1]) / length,
      (c[0] - a[0]) / length,
      (c[1] - a[1]) / length,
    ];
  }, selector);
}

async function expectMatchingOrientation() {
  await browser.waitUntil(
    async () => {
      const [source, slab] = await Promise.all([
        markerFrame(SOURCE),
        markerFrame(VIEWER + ' canvas'),
      ]);
      return (
        !!source &&
        !!slab &&
        source.every((value, index) => Math.abs(value - slab[index]) < 0.025)
      );
    },
    {
      timeoutMsg: 'Expected slab landmarks to match ordinary slice orientation',
    }
  );
}

async function setDepth(depth: number) {
  await $('[data-testid="enface-controls"]').click();
  await expandEnFaceSection('projection');
  await setSlabRange(depth, depth);
  await browser.keys('Escape');
}

describe('Slab orientation follows ordinary volume views', () => {
  for (const frame of frames) {
    for (const axis of [0, 1, 2]) {
      it(`matches ${frame.axes[axis]} for ${frame.name} source axis ${axis}`, async () => {
        await stage(axis, frame);
        await chooseEnFaceProjection(
          'enface-projection-axis',
          frame.axes[axis]
        );
        await setEnFaceWindow(220, 130);
        await setDepth(48);
        await expectMatchingOrientation();
        for (const depth of [95, 0]) {
          await setDepth(depth);
          await expectMatchingOrientation();
        }
        expect(await volViewPage.getNotificationsCount()).toBe(0);
      });
    }
  }
});
