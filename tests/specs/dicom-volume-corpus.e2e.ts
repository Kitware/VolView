import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Key } from 'webdriverio';
import corpus from '../dicomVolumeCorpus.json';
import { DATASET_CACHE } from '../downloadDatasets';
import { openDicomConsumer } from '../dicomConsumer';
import {
  fixtureBytes,
  nullPaddedFixtureBytes,
} from '../fixtures/dicom-consumer/fixtureData';
import { startDicomConsumerFixtures } from '../fixtures/dicom-consumer/server.mjs';
import { volViewPage } from '../pageobjects/volview.page';
import {
  waitForRenderedSlice,
  waitForRenderedSliceChange,
} from './dicomRenderedSlice';

type VolumeExpectation = {
  dimensions: number[];
  range: number[];
  pixelHash: string;
  spacing?: number[];
  origin?: number[];
  direction?: number[];
};

const fractionalCalibration = { rescaleSlope: 1.9413152, rescaleIntercept: 0 };
const calibratedValue = 5 * fractionalCalibration.rescaleSlope;
const pixelHash = (value: number) =>
  createHash('sha256')
    .update(Buffer.from(new Float64Array(16).fill(value).buffer))
    .digest('hex');

// Expected hashes were independently decoded with pydicom. Each lossless
// variant must preserve every calibrated voxel, including frame order.
const cases: Array<{
  name: string;
  expected?: VolumeExpectation;
  expectedError?: string;
}> = [
  ...corpus,
  {
    name: 'null-padded-numbers.dcm',
    expected: {
      dimensions: [4, 4, 1],
      range: [-10, -10],
      spacing: [3, 2, 4],
      origin: [10, 20, 30],
      pixelHash: pixelHash(-10),
    },
  },
  {
    name: 'null-padded-fractional-rescale.dcm',
    expected: {
      dimensions: [4, 4, 1],
      range: [calibratedValue, calibratedValue],
      pixelHash: pixelHash(calibratedValue),
    },
  },
];

async function expectNumbers(id: string, expected: number[]) {
  const actual = (await $(`#${id}`).getText()).split(', ').map(Number);
  for (const [axis, value] of expected.entries()) {
    expect(actual[axis]).toBeCloseTo(value, 8);
  }
}

describe('Public DICOM volume corpus', () => {
  let fixture: Awaited<ReturnType<typeof startDicomConsumerFixtures>>;
  before(async () => {
    const files = Object.fromEntries(
      corpus.map(({ name }) => [
        name,
        readFileSync(resolve(DATASET_CACHE, name)),
      ])
    );
    fixture = await startDicomConsumerFixtures(fixtureBytes(), {
      kinds: ['corpus'],
      fixtures: {
        ...files,
        'null-padded-numbers.dcm': nullPaddedFixtureBytes(),
        'null-padded-fractional-rescale.dcm': nullPaddedFixtureBytes(
          fractionalCalibration
        ),
      },
    });
  });
  after(async () => fixture?.close());

  for (const { name, expected, expectedError } of cases) {
    for (const source of ['file', 'http']) {
      const behavior = expectedError ? 'rejects' : 'preserves';
      it(`${behavior} ${name} pixels and geometry from ${source}`, async () => {
        const params = new URLSearchParams({ name, source });
        await openDicomConsumer(
          `${fixture.urls.corpus}?${params}`,
          expectedError
        );
        if (expectedError) return;
        if (!expected) throw new Error(`Missing expectations for ${name}`);
        await expect($('#dimensions')).toHaveText(
          expected.dimensions.join(', ')
        );
        await expect($('#pixel-hash')).toHaveText(expected.pixelHash);
        await expectNumbers('range', expected.range);
        for (const id of ['spacing', 'origin', 'direction'] as const) {
          if (expected[id]) await expectNumbers(id, expected[id]);
        }
      });
    }
  }
});

describe('VolView multiframe volume import', () => {
  const volumes = corpus.filter(
    ({ modality, expected }) =>
      expected &&
      expected.dimensions[2] > 1 &&
      (modality === 'CT' || modality === 'NM')
  );
  for (const { name, expected } of volumes) {
    it(`displays ${name} as a complete volume`, async () => {
      await volViewPage.open(`?urls=[tmp/${name}]`);
      await volViewPage.waitForVolumeCardSliceCounts([expected!.dimensions[2]]);
      await volViewPage.waitForViews();
      await expect($('.loading-indicator')).not.toBeExisting();
      const before = await waitForRenderedSlice(`${name}-initial.png`);
      await volViewPage.focusFirst2DView();
      const label = await $(
        '[data-testid~="vtk-two-view"] .slice-label'
      ).getText();
      const match = label.match(/Slice:\s*(\d+)\s*\/\s*(\d+)/);
      if (!match) throw new Error('Expected a displayed slice counter');
      const slice = Number(match[1]);
      const total = Number(match[2]);
      if (total <= 1) throw new Error('Expected navigable image planes');
      const delta = slice > 1 ? -1 : 1;
      const steps = Math.min(3, delta < 0 ? slice - 1 : total - slice);
      for (let offset = 1; offset <= steps; offset++) {
        await browser.keys([delta < 0 ? Key.ArrowDown : Key.ArrowUp]);
        await browser.waitUntil(
          async () =>
            (await volViewPage.getFirst2DSlice()) === slice + delta * offset,
          {
            timeoutMsg:
              'Expected the displayed slice counter to follow navigation',
          }
        );
      }
      await waitForRenderedSliceChange(before, `${name}-navigated.png`);
      expect(await volViewPage.getNotificationsCount()).toBe(0);
    });
  }
});
