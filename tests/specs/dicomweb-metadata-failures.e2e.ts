import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import { startDicomWebServer } from '../server/dicomweb-server';
import { buildSyntheticDicom, newUid } from './syntheticDicom';

const SLICE_COUNT = 3;

const tag = (vr: string, value: unknown) => ({ vr, Value: [value] });

// A QIDO-RS series search result in the DICOM JSON model.
const seriesRecord = (studyUid: string, seriesUid: string) => ({
  '00100010': tag('PN', { Alphabetic: 'DICOMWeb^Patient' }),
  '00100020': tag('LO', 'dicomweb-patient'),
  '0020000D': tag('UI', studyUid),
  '0020000E': tag('UI', seriesUid),
  '00080060': tag('CS', 'MR'),
  '0008103E': tag('LO', 'Linked series'),
});

const makeSeries = (studyUid = newUid()) => {
  const seriesUid = newUid();
  const sopUids = Array.from({ length: SLICE_COUNT }, () => newUid());
  return {
    studyUid,
    seriesUid,
    search: [seriesRecord(studyUid, seriesUid)],
    metadata: sopUids.map((sopUid, i) => ({
      ...seriesRecord(studyUid, seriesUid),
      '00080018': tag('UI', sopUid),
      '00200013': tag('IS', String(i + 1)),
      '00280010': tag('US', 4),
      '00280011': tag('US', 4),
    })),
    dicoms: sopUids.map((sopUid, i) =>
      buildSyntheticDicom({
        studyUid,
        seriesUid,
        sopUid,
        instanceNumber: i + 1,
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        imagePositionPatient: [0, 0, i],
      })
    ),
  };
};

const dicomWebMessage = (page: Page) =>
  page.locator('#data-module p.error-message');

test.describe('DICOMWeb metadata failures', () => {
  let server: Awaited<ReturnType<typeof startDicomWebServer>>;

  test.beforeEach(async () => {
    server = await startDicomWebServer();
  });

  test.afterEach(async () => {
    await server.stop();
  });

  const linkTo = (volview: VolViewPage, ...path: string[]) =>
    volview.open(`?dicomweb=${[server.root, ...path].join('/')}`);

  const linkToSeries = (
    volview: VolViewPage,
    { studyUid, seriesUid }: ReturnType<typeof makeSeries>
  ) => linkTo(volview, 'studies', studyUid, 'series', seriesUid);

  test('loads a linked series once its failed metadata request is retried', async ({
    page,
    volview,
  }) => {
    const series = makeSeries();
    server.replies.seriesMetadata = { status: 500 };
    await linkToSeries(volview, series);

    await expect(dicomWebMessage(page)).toContainText(
      'Error fetching DICOMWeb data'
    );
    expect(await volview.getNotificationsCount()).toBe(0);

    server.replies.seriesSearch = { status: 200, json: series.search };
    server.replies.seriesMetadata = { status: 200, json: series.metadata };
    server.replies.seriesRetrieval = { status: 200, dicoms: series.dicoms };
    // Closing Settings unmounts the DICOMWeb fields, which retries a failed fetch.
    await volview.openSettings();
    await volview.closeSettings();

    await expect(page.locator('.volume-card .mdi-check')).toBeVisible();
    await volview.waitForViews();
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('reports a linked series with no metadata without starting a download', async ({
    page,
    volview,
  }) => {
    server.replies.seriesMetadata = { status: 200, json: [] };
    await linkToSeries(volview, makeSeries());

    await expect(dicomWebMessage(page)).toHaveText('Found zero dicoms.');
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('reports a linked series that its metadata does not describe', async ({
    volview,
  }) => {
    const linked = makeSeries();
    const other = makeSeries(linked.studyUid);
    server.replies.seriesSearch = { status: 200, json: other.search };
    server.replies.seriesMetadata = { status: 200, json: other.metadata };
    await linkToSeries(volview, linked);

    await volview.waitForNotification();
    expect(await volview.getNotificationTitles()).toEqual([
      'Failed to load DICOM',
    ]);
  });

  test('lists the studies of a search that also returns a record without a study UID', async ({
    page,
    volview,
  }) => {
    const { studyUid, seriesUid } = makeSeries();
    server.replies.studySearch = {
      status: 200,
      json: [
        seriesRecord(studyUid, seriesUid),
        {
          '00100010': tag('PN', { Alphabetic: 'Malformed^Record' }),
          '0020000E': tag('UI', newUid()),
        },
      ],
    };
    await linkTo(volview);

    await expect(page.locator('#data-module .patient-header-name')).toHaveText(
      'DICOMWeb^Patient'
    );
  });

  test('stops the series spinner when browsing a study whose series metadata fails', async ({
    page,
    volview,
  }) => {
    const series = makeSeries();
    server.replies.seriesSearch = { status: 200, json: series.search };
    server.replies.seriesMetadata = { status: 500 };
    await linkTo(volview, 'studies', series.studyUid);

    await volview.waitForNotification();
    await expect(page.locator('.volume-list')).toBeAttached();
    await expect(page.locator('.volume-list .fetching')).not.toBeAttached();
    expect(await volview.getNotificationTitles()).toEqual([
      'Failed to fetch DICOMWeb metadata',
    ]);
  });
});
