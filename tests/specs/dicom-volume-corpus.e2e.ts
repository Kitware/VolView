import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import volumeCorpus from '../dicomVolumeCorpus.json' with { type: 'json' };
import extendedCorpus from '../dicomExtendedCorpus.json' with { type: 'json' };
import { DATASET_CACHE, isCached } from '../downloadDatasets';
import { openDicomPage } from '../dicomPages';
import { nullPaddedFixtureBytes } from '../fixtures/dicom-pages/fixtureData';
import { GENERATED_CORPUS } from '../fixtures/dicom-pages/generatedCorpus';
import { startDicomPages } from '../fixtures/dicom-pages/server.mjs';
import { test, expect } from '../fixtures';
import { createRenderedSlice } from './dicomRenderedSlice';

type Pixels =
  | { kind: 'hash'; value: string }
  | { kind: 'stats'; min: number[]; max: number[]; mean: number[] };

type CorpusEntry = {
  id: string;
  name: string;
  sha256?: string;
  generator?: string;
  facts: {
    modality: string;
    volume?: {
      dimensions: number[];
      pixels: Pixels;
      range?: number[];
      spacing?: number[];
      origin?: number[];
      direction?: number[];
    };
  };
  module: {
    outcome: 'volume' | 'error';
    error?: string;
    fallbackGeometry?: boolean;
    spacing?: number[];
    reconstruction?: string;
  };
};

// The manifests are checked against the reference tool, not by TypeScript.
const entriesOf = (datasets: unknown) => datasets as CorpusEntry[];
const extended = process.env.DICOM_CORPUS === 'extended';
const corpus = entriesOf(volumeCorpus.datasets);
const slowCorpus = extended ? entriesOf(extendedCorpus.datasets) : [];
const { statsTolerance } = volumeCorpus;

const cachePath = ({ name }: CorpusEntry) => resolve(DATASET_CACHE, name);
const bytesOf = (entry: CorpusEntry) =>
  entry.generator
    ? GENERATED_CORPUS[entry.generator]()
    : readFileSync(cachePath(entry));

const fractionalCalibration = { rescaleSlope: 1.9413152, rescaleIntercept: 0 };
// A Float32 volume holds this fractional rescale, so samples are float32-rounded.
const calibratedValue = Math.fround(5 * fractionalCalibration.rescaleSlope);
const pixelHash = (value: number) =>
  createHash('sha256')
    .update(Buffer.from(new Float64Array(16).fill(value).buffer))
    .digest('hex');

const synthetic = (
  name: string,
  value: number,
  geometry: { spacing?: number[]; origin?: number[] } = {}
): CorpusEntry => ({
  id: name,
  name,
  facts: {
    modality: 'CT',
    volume: {
      dimensions: [4, 4, 1],
      range: [value, value],
      pixels: { kind: 'hash', value: pixelHash(value) },
      ...geometry,
    },
  },
  module: { outcome: 'volume' },
});

const syntheticCases = [
  synthetic('null-padded-numbers.dcm', -10, {
    spacing: [3, 2, 4],
    origin: [10, 20, 30],
  }),
  synthetic('null-padded-fractional-rescale.dcm', calibratedValue),
];

async function expectNumbers(
  page: Page,
  id: string,
  expected: number[],
  tolerance = 1e-8
) {
  const actual = (await page.locator(`#${id}`).innerText())
    .split(', ')
    .map(Number);
  for (const [axis, value] of expected.entries()) {
    expect(Math.abs(actual[axis] - value)).toBeLessThanOrEqual(tolerance);
  }
}

async function expectPixels(page: Page, expected: Pixels) {
  if (expected.kind === 'hash') {
    await expect(page.locator('#pixel-hash')).toHaveText(expected.value);
    return;
  }
  const actual = JSON.parse(await page.locator('#pixel-stats').innerText());
  for (const key of ['min', 'max', 'mean'] as const) {
    expect(actual[key]).toHaveLength(expected[key].length);
    expected[key].forEach((value, channel) =>
      expect(Math.abs(actual[key][channel] - value)).toBeLessThanOrEqual(
        statsTolerance
      )
    );
  }
}

async function expectModuleOutcome(page: Page, entry: CorpusEntry) {
  const { facts, module } = entry;
  const volume = facts.volume!;
  await expect(page.locator('#dimensions')).toHaveText(
    volume.dimensions.join(', ')
  );
  await expectPixels(page, volume.pixels);
  if (volume.range) await expectNumbers(page, 'range', volume.range, 1e-6);
  for (const id of ['spacing', 'origin', 'direction'] as const) {
    const values = volume[id];
    if (values) await expectNumbers(page, id, values, 1e-4);
  }
  if (module.spacing)
    await expectNumbers(page, 'spacing', module.spacing, 1e-4);
  if (module.fallbackGeometry) {
    await expectNumbers(page, 'origin', [0, 0, 0]);
    await expectNumbers(page, 'direction', [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }
  if (module.reconstruction)
    await expect(page.locator('#reconstruction')).toHaveText(
      module.reconstruction
    );
}

test.describe('Public DICOM volume corpus', () => {
  // Decided per entry, so one unreachable extended source skips only itself.
  const available = slowCorpus.filter(
    ({ name, sha256 }) => sha256 !== undefined && isCached({ name, sha256 })
  );
  const unavailable = slowCorpus.filter((entry) => !available.includes(entry));
  let fixture: Awaited<ReturnType<typeof startDicomPages>>;
  test.beforeAll(async () => {
    const files = Object.fromEntries(
      await Promise.all(
        [...corpus, ...available].map(
          async (entry) => [entry.name, await bytesOf(entry)] as const
        )
      )
    );
    fixture = await startDicomPages({
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
  test.afterAll(async () => fixture?.close());

  async function expectEntry(page: Page, entry: CorpusEntry, source: string) {
    const params = new URLSearchParams({ name: entry.name, source });
    const url = `${fixture.urls.corpus}?${params}`;
    if (entry.module.outcome === 'error') {
      await openDicomPage(page, url, entry.module.error);
      return;
    }
    await openDicomPage(page, url);
    await expectModuleOutcome(page, entry);
  }

  const sourcedCases = [
    ...[...corpus, ...syntheticCases].flatMap((entry) =>
      ['file', 'http'].map((source) => ({ entry, source }))
    ),
    // The slow tier exercises files, not transports; the fast tier covers both.
    ...available.map((entry) => ({ entry, source: 'file' })),
  ];
  for (const { entry, source } of sourcedCases) {
    test(`matches the corpus facts for ${entry.id} from ${source}`, async ({
      page,
    }) => {
      await expectEntry(page, entry, source);
    });
  }
  for (const entry of unavailable) {
    test.skip(`${entry.id}: source unreachable when the run started`, () => {});
  }

  // Each frame is its own ranged read, which this server answers with the file.
  test('preserves a multiframe volume from a server that ignores Range', async ({
    page,
  }) => {
    const multiframe = corpus.find(
      ({ facts, module, generator }) =>
        !generator &&
        module.outcome === 'volume' &&
        (facts.volume?.dimensions[2] ?? 0) > 30
    );
    if (!multiframe) throw new Error('No multiframe corpus file');
    await expectEntry(page, multiframe, 'unranged');
  });
});

test.describe('VolView multiframe volume import', () => {
  const volumes = corpus.filter(
    ({ facts, module, generator }) =>
      !generator &&
      module.outcome === 'volume' &&
      (facts.volume?.dimensions[2] ?? 0) > 1 &&
      (facts.modality === 'CT' || facts.modality === 'NM')
  );
  for (const { name, facts } of volumes) {
    const expected = facts.volume;
    test(`displays ${name} as a complete volume`, async ({
      page,
      volview,
      utils,
    }) => {
      const { waitForRenderedSlice, waitForRenderedSliceChange } =
        createRenderedSlice(page, utils);
      await volview.open(`?urls=[tmp/${name}]`);
      await volview.waitForVolumeCardSliceCounts([expected!.dimensions[2]]);
      await volview.waitForViewsLoaded();
      const before = await waitForRenderedSlice(`${name}-initial.png`);
      await volview.focusFirst2DView();
      const label = await page
        .locator('[data-testid~="vtk-two-view"] .slice-label')
        .first()
        .innerText();
      const match = label.match(/Slice:\s*(\d+)\s*\/\s*(\d+)/);
      if (!match) throw new Error('Expected a displayed slice counter');
      const slice = Number(match[1]);
      const total = Number(match[2]);
      if (total <= 1) throw new Error('Expected navigable image planes');
      const delta = slice > 1 ? -1 : 1;
      const steps = Math.min(3, delta < 0 ? slice - 1 : total - slice);
      for (let offset = 1; offset <= steps; offset++) {
        await page.keyboard.press(delta < 0 ? 'ArrowDown' : 'ArrowUp');
        await expect
          .poll(volview.getFirst2DSlice, {
            message:
              'Expected the displayed slice counter to follow navigation',
          })
          .toBe(slice + delta * offset);
      }
      await waitForRenderedSliceChange(before, `${name}-navigated.png`);
      expect(await volview.getNotificationsCount()).toBe(0);
    });
  }
});
