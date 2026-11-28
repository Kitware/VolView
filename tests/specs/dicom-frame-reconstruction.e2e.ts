import { createHash } from 'node:crypto';
import { test, expect } from '../fixtures';
import { openDicomPage } from '../dicomPages';
import { enhancedFixtureBytes } from '../fixtures/dicom-pages/enhancedFixtures';
import { startDicomPages } from '../fixtures/dicom-pages/server.mjs';

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

test.describe('Encoded multiframe reconstruction contracts', () => {
  let fixture: Awaited<ReturnType<typeof startDicomPages>>;
  test.beforeAll(async () => {
    fixture = await startDicomPages({ kinds: ['corpus'], fixtures: frames });
  });
  test.afterAll(async () => fixture?.close());

  for (const { name, source, values, reconstruction } of scenarios) {
    test(`loads ${name} frames from ${source} in frame order with ${reconstruction} reconstruction`, async ({
      page,
    }) => {
      const params = new URLSearchParams({ name, source });
      await openDicomPage(page, `${fixture.urls.corpus}?${params}`);
      await expect(page.locator('#pixel-hash')).toHaveText(hashFrames(values));
      await expect(page.locator('#reconstruction')).toHaveText(reconstruction);
    });
  }
});

test.describe('Multiframe reconstruction notices', () => {
  test('shows the user why temporal frames have approximate spatial placement', async ({
    page,
    scratch,
    volview,
  }) => {
    const file = 'enhanced-temporal.dcm';
    scratch.writeFile(file, frames.temporal);
    await volview.open(`?urls=[tmp/${file}]`);
    await volview.waitForVolumeCardSliceCounts([2]);
    await volview.waitForViews();
    expect(await volview.getNotificationsCount()).toBe(1);
    await volview.openNotifications();
    const warning = page.locator('.message-center .warn-message');
    await expect(warning).toContainText('did not load as one sound volume');
    await warning.click();
    await expect(page.locator('.message-center .details')).toContainText(
      'positions and measurements'
    );
  });
});
