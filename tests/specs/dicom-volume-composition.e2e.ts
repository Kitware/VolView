import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import corpus from '../dicomCompositionCorpus.json';
import { DATASET_CACHE } from '../downloadDatasets';
import { waitForDicomPage } from '../dicomPages';
import { startDicomPages } from '../fixtures/dicom-pages/server.mjs';
import { volViewPage } from '../pageobjects/volview.page';
import { waitForRenderedSlice } from './dicomRenderedSlice';

type ExpectedVolume = (typeof corpus.cases)[number]['volumes'][number];

async function expectComposedVolumes(
  volumes: ExpectedVolume[],
  partial: boolean
) {
  await expect($$('.volume')).toBeElementsArrayOfSize(volumes.length);
  for (const volume of volumes) {
    const members = partial
      ? volume.sopInstanceUIDs.filter((_, index) => index % 2 === 0)
      : volume.sopInstanceUIDs;
    const expected = partial ? volume.initial : volume.expected;
    const section = $(`.volume[data-first-sop="${members[0]}"]`);
    await expect(section.$('[data-field="members"]')).toHaveText(
      members.join(', ')
    );
    await expect(section.$('[data-field="pixel-hash"]')).toHaveText(
      expected.pixelHash
    );
    await expect(section.$('[data-field="dimensions"]')).toHaveText(
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
      const actual = (await section.$(`[data-field="${name}"]`).getText())
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

describe('Downloaded DICOM volume composition', () => {
  let fixture: Awaited<ReturnType<typeof startDicomPages>>;
  before(async () => {
    const fixtures = Object.fromEntries(
      corpus.datasets.map(({ name }) => [
        name,
        readFileSync(resolve(DATASET_CACHE, name)),
      ])
    );
    fixture = await startDicomPages({ kinds: ['composition'], fixtures });
  });
  after(async () => fixture?.close());

  // Composition never sees where bytes come from, so each axis is covered once.
  const imports = [
    ['file', 'batch'],
    ['http', 'incremental'],
  ];
  for (const scenario of corpus.cases) {
    for (const [source, mode] of imports) {
      it(`composes every ${scenario.id} collection from shuffled ${source} sources in ${mode} mode`, async () => {
        await browser.url(
          `${fixture.urls.composition}?${new URLSearchParams({ case: scenario.id, source, mode })}`
        );
        if (mode === 'incremental') {
          await waitForDicomPage(undefined, 'partial');
          await expectComposedVolumes(scenario.volumes, true);
          await $('#complete-import').click();
        }
        await waitForDicomPage();
        await expectComposedVolumes(scenario.volumes, false);
      });
    }
  }
});

describe('VolView downloaded collection import', () => {
  for (const scenario of corpus.cases) {
    it(`keeps the ${scenario.id} volumes separate in the application`, async () => {
      const urls = scenario.volumes
        .flatMap(({ files }) => files.map((name) => `tmp/${name}`))
        .reverse();
      await volViewPage.open(`?urls=[${urls.join(',')}]`);
      await volViewPage.waitForVolumeCardSliceCounts(
        scenario.volumes
          .map(({ expected }) => expected.dimensions[2])
          .sort((a, b) => a - b)
      );
      await volViewPage.waitForViewsLoaded();
      await waitForRenderedSlice(
        `composition-${scenario.id}.png`,
        scenario.id === 'pet-ct'
      );
      expect(await volViewPage.getNotificationsCount()).toBe(0);
    });
  }
});
