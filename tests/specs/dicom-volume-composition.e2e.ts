import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import corpus from '../dicomCompositionCorpus.json' with { type: 'json' };
import { DATASET_CACHE } from '../downloadDatasets';
import { waitForDicomPage } from '../dicomPages';
import { startDicomPages } from '../fixtures/dicom-pages/server.mjs';
import { test, expect } from '../fixtures';
import { createRenderedSlice } from './dicomRenderedSlice';

type ExpectedVolume = (typeof corpus.cases)[number]['volumes'][number];

async function expectComposedVolumes(
  page: Page,
  volumes: ExpectedVolume[],
  partial: boolean
) {
  await expect(page.locator('.volume')).toHaveCount(volumes.length);
  for (const volume of volumes) {
    const members = partial
      ? volume.sopInstanceUIDs.filter((_, index) => index % 2 === 0)
      : volume.sopInstanceUIDs;
    const expected = partial ? volume.initial : volume.expected;
    const section = page.locator(`.volume[data-first-sop="${members[0]}"]`);
    await expect(section.locator('[data-field="members"]')).toHaveText(
      members.join(', ')
    );
    await expect(section.locator('[data-field="pixel-hash"]')).toHaveText(
      expected.pixelHash
    );
    await expect(section.locator('[data-field="dimensions"]')).toHaveText(
      expected.dimensions.join(', ')
    );
    const numeric = {
      spacing: expected.spacing,
      origin: expected.origin,
      direction: expected.direction,
      range: expected.range,
      'first-plane': expected.firstPlanePosition,
      'last-plane': expected.lastPlanePosition,
    };
    for (const [name, values] of Object.entries(numeric)) {
      const actual = (
        await section.locator(`[data-field="${name}"]`).innerText()
      )
        .split(', ')
        .map(Number);
      expect(actual).toHaveLength(values.length);
      values.forEach((value, index) =>
        expect(Math.abs(actual[index] - value)).toBeLessThanOrEqual(
          corpus.geometryToleranceMm
        )
      );
    }
  }
}

test.describe('Downloaded DICOM volume composition', () => {
  let fixture: Awaited<ReturnType<typeof startDicomPages>>;
  test.beforeAll(async () => {
    const fixtures = Object.fromEntries(
      corpus.datasets.map(({ name }) => [
        name,
        readFileSync(resolve(DATASET_CACHE, name)),
      ])
    );
    fixture = await startDicomPages({ kinds: ['composition'], fixtures });
  });
  test.afterAll(async () => fixture?.close());

  // Composition never sees where bytes come from, so each axis is covered once.
  const imports = [
    ['file', 'batch'],
    ['http', 'incremental'],
  ];
  for (const scenario of corpus.cases) {
    for (const [source, mode] of imports) {
      test(`composes every ${scenario.id} collection from shuffled ${source} sources in ${mode} mode`, async ({
        page,
      }) => {
        await page.goto(
          `${fixture.urls.composition}?${new URLSearchParams({ case: scenario.id, source, mode })}`
        );
        if (mode === 'incremental') {
          await waitForDicomPage(page, undefined, 'partial');
          await expectComposedVolumes(page, scenario.volumes, true);
          await page.locator('#complete-import').click();
        }
        await waitForDicomPage(page);
        await expectComposedVolumes(page, scenario.volumes, false);
      });
    }
  }
});

test.describe('VolView downloaded collection import', () => {
  for (const scenario of corpus.cases) {
    test(`keeps the ${scenario.id} volumes separate in the application`, async ({
      page,
      volview,
      utils,
    }) => {
      const { waitForRenderedSlice } = createRenderedSlice(page, utils);
      const urls = scenario.volumes
        .flatMap(({ files }) => files.map((name) => `tmp/${name}`))
        .reverse();
      await volview.open(`?urls=[${urls.join(',')}]`);
      await volview.waitForVolumeCardSliceCounts(
        scenario.volumes
          .map(({ expected }) => expected.dimensions[2])
          .sort((a, b) => a - b)
      );
      await volview.waitForViewsLoaded();
      await waitForRenderedSlice(
        `composition-${scenario.id}.png`,
        scenario.id === 'pet-ct'
      );
      expect(await volview.getNotificationsCount()).toBe(0);
    });
  }
});
