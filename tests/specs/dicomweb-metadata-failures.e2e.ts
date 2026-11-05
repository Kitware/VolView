import { volViewPage } from '../pageobjects/volview.page';
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

const dicomWebMessage = () => $('#data-module p.error-message');

describe('DICOMWeb metadata failures', () => {
  let server: Awaited<ReturnType<typeof startDicomWebServer>>;

  const linkTo = (...path: string[]) =>
    volViewPage.open(`?dicomweb=${[server.root, ...path].join('/')}`);

  const linkToSeries = ({
    studyUid,
    seriesUid,
  }: ReturnType<typeof makeSeries>) =>
    linkTo('studies', studyUid, 'series', seriesUid);

  beforeEach(async () => {
    server = await startDicomWebServer();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('loads a linked series once its failed metadata request is retried', async () => {
    const series = makeSeries();
    server.replies.seriesMetadata = { status: 500 };
    await linkToSeries(series);

    await expect(dicomWebMessage()).toHaveText(
      expect.stringContaining('Error fetching DICOMWeb data')
    );
    expect(await volViewPage.getNotificationsCount()).toBe(0);

    server.replies.seriesSearch = { status: 200, json: series.search };
    server.replies.seriesMetadata = { status: 200, json: series.metadata };
    server.replies.seriesRetrieval = { status: 200, dicoms: series.dicoms };
    // Closing Settings unmounts the DICOMWeb fields, which retries a failed fetch.
    await volViewPage.openSettings();
    await volViewPage.closeSettings();

    await $('.volume-card .mdi-check').waitForDisplayed();
    await volViewPage.waitForViews();
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('reports a linked series with no metadata without starting a download', async () => {
    server.replies.seriesMetadata = { status: 200, json: [] };
    await linkToSeries(makeSeries());

    await expect(dicomWebMessage()).toHaveText('Found zero dicoms.');
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('reports a linked series that its metadata does not describe', async () => {
    const linked = makeSeries();
    const other = makeSeries(linked.studyUid);
    server.replies.seriesSearch = { status: 200, json: other.search };
    server.replies.seriesMetadata = { status: 200, json: other.metadata };
    await linkToSeries(linked);

    await volViewPage.waitForNotification();
    expect(await volViewPage.getNotificationTitles()).toEqual([
      'Failed to load DICOM',
    ]);
  });

  it('lists the studies of a search that also returns a record without a study UID', async () => {
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
    await linkTo();

    await expect($('#data-module .patient-header-name')).toHaveText(
      'DICOMWeb^Patient'
    );
  });

  it('stops the series spinner when browsing a study whose series metadata fails', async () => {
    const series = makeSeries();
    server.replies.seriesSearch = { status: 200, json: series.search };
    server.replies.seriesMetadata = { status: 500 };
    await linkTo('studies', series.studyUid);

    await volViewPage.waitForNotification();
    await expect($('.volume-list')).toExist();
    await expect($('.volume-list .fetching')).not.toExist();
    expect(await volViewPage.getNotificationTitles()).toEqual([
      'Failed to fetch DICOMWeb metadata',
    ]);
  });
});
