import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { openDicomConsumer } from '../dicomConsumer';
import { enhancedFixtureBytes } from '../fixtures/dicom-consumer/enhancedFixtures';
import { fixtureBytes } from '../fixtures/dicom-consumer/fixtureData';
import { startDicomConsumerFixtures } from '../fixtures/dicom-consumer/server.mjs';
import { volViewPage } from '../pageobjects/volview.page';

const frames = {
  uneven: enhancedFixtureBytes({
    pixelValues: [20, 120, 220],
    positions: [
      [10, 20, 30],
      [10, 20, 31],
      [10, 20, 33],
    ],
  }),
  temporal: enhancedFixtureBytes({
    pixelValues: [20, 120],
    sharedPosition: [10, 20, 30],
    temporalPositions: [1, 2],
  }),
  varying: enhancedFixtureBytes({
    pixelValues: [2, 2],
    transforms: [
      [1, 0],
      [2, 0],
    ],
  }),
  uniform: enhancedFixtureBytes({
    pixelValues: [2, 2],
    transforms: [
      [2, 0],
      [2, 0],
    ],
  }),
};

const hashFrames = (values: number[]) =>
  createHash('sha256')
    .update(
      Buffer.from(
        Float64Array.from(values.flatMap((value) => Array(16).fill(value)))
          .buffer
      )
    )
    .digest('hex');
const irregular = 'Cannot allocate irregular DICOM geometry: ';
const scenarios = [
  {
    name: 'uneven',
    policy: 'preserve-order',
    values: [20, 120, 220],
    reconstruction: 'irregular',
  },
  {
    name: 'uneven',
    policy: 'reject',
    error: `${irregular}uneven-slice-spacing`,
  },
  {
    name: 'temporal',
    policy: 'reject',
    error: `${irregular}unreadable-geometry`,
  },
  {
    name: 'varying',
    error:
      'Cannot load DICOM frames with differing modality rescale: the decoder applies one transform to the entire instance',
  },
  {
    name: 'varying',
    decoder: 'custom',
    values: [2, 4],
    reconstruction: 'regular',
  },
  { name: 'uniform', values: [4, 4], reconstruction: 'regular' },
];

describe('Encoded multiframe reconstruction contracts', () => {
  let fixture: Awaited<ReturnType<typeof startDicomConsumerFixtures>>;
  before(async () => {
    fixture = await startDicomConsumerFixtures(fixtureBytes(), {
      kinds: ['corpus'],
      fixtures: frames,
    });
  });
  after(async () => fixture?.close());

  for (const scenario of scenarios) {
    for (const source of ['file', 'http']) {
      it(`handles ${scenario.name} frames from ${source} with ${scenario.decoder ?? 'default'} decoding and ${scenario.policy ?? 'default'} geometry policy`, async () => {
        const params = new URLSearchParams({ name: scenario.name, source });
        if (scenario.policy) params.set('policy', scenario.policy);
        if (scenario.decoder) params.set('decoder', scenario.decoder);
        await openDicomConsumer(
          `${fixture.urls.corpus}?${params}`,
          scenario.error
        );
        if (scenario.values) {
          await expect($('#pixel-hash')).toHaveText(
            hashFrames(scenario.values)
          );
          await expect($('#reconstruction')).toHaveText(
            scenario.reconstruction
          );
        }
      });
    }
  }
});

describe('Multiframe reconstruction notices', () => {
  for (const name of ['uneven', 'temporal'] as const) {
    it(`shows the user why ${name} frames have approximate spatial placement`, async () => {
      const file = `enhanced-${name}.dcm`;
      writeFileSync(resolve(TEMP_DIR, file), frames[name]);
      await volViewPage.open(`?urls=[tmp/${file}]`);
      await volViewPage.waitForVolumeCardSliceCounts([
        name === 'uneven' ? 3 : 2,
      ]);
      await volViewPage.waitForViews();
      expect(await volViewPage.getNotificationsCount()).toBe(1);
      await volViewPage.notifications.click();
      const warning = $('.message-center .warn-message');
      await expect(warning).toHaveText(
        expect.stringContaining('did not load as one sound volume')
      );
      await warning.click();
      await expect($('.message-center .details')).toHaveText(
        expect.stringContaining('positions and measurements')
      );
    });
  }
});
