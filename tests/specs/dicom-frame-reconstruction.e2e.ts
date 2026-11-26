import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { openDicomPage } from '../dicomPages';
import { enhancedFixtureBytes } from '../fixtures/dicom-pages/enhancedFixtures';
import { startDicomPages } from '../fixtures/dicom-pages/server.mjs';
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
  uniform: enhancedFixtureBytes({
    pixelValues: [2, 2],
    transforms: [
      [2, 0],
      [2, 0],
    ],
  }),
  differing: enhancedFixtureBytes({
    pixelValues: [2, 2],
    transforms: [
      [1, 0],
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

const scenarios = [
  {
    name: 'uneven',
    source: 'file',
    values: [20, 120, 220],
    reconstruction: 'irregular',
  },
  {
    name: 'uniform',
    source: 'http',
    values: [4, 4],
    reconstruction: 'regular',
  },
  {
    name: 'differing',
    source: 'file',
    values: [2, 4],
    reconstruction: 'regular',
  },
];

describe('Encoded multiframe reconstruction contracts', () => {
  let fixture: Awaited<ReturnType<typeof startDicomPages>>;
  before(async () => {
    fixture = await startDicomPages({ kinds: ['corpus'], fixtures: frames });
  });
  after(async () => fixture?.close());

  for (const { name, source, values, reconstruction } of scenarios) {
    it(`loads ${name} frames from ${source} in frame order with ${reconstruction} reconstruction`, async () => {
      const params = new URLSearchParams({ name, source });
      await openDicomPage(`${fixture.urls.corpus}?${params}`);
      await expect($('#pixel-hash')).toHaveText(hashFrames(values));
      await expect($('#reconstruction')).toHaveText(reconstruction);
    });
  }
});

describe('Multiframe reconstruction notices', () => {
  it('shows the user why temporal frames have approximate spatial placement', async () => {
    const file = 'enhanced-temporal.dcm';
    writeFileSync(resolve(TEMP_DIR, file), frames.temporal);
    await volViewPage.open(`?urls=[tmp/${file}]`);
    await volViewPage.waitForVolumeCardSliceCounts([2]);
    await volViewPage.waitForViews();
    expect(await volViewPage.getNotificationsCount()).toBe(1);
    await volViewPage.openNotifications();
    const warning = $('.message-center .warn-message');
    await expect(warning).toHaveText(
      expect.stringContaining('did not load as one sound volume')
    );
    await warning.click();
    await expect($('.message-center .details')).toHaveText(
      expect.stringContaining('positions and measurements')
    );
  });
});
