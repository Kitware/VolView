import { api } from 'dicomweb-client';

let fileCounter = 0;

export interface FetchSeriesOptions {
  studyInstanceUID: string;
  seriesInstanceUID: string;
}

function makeClient(dicomWebRoot: string) {
  return new api.DICOMwebClient({
    url: dicomWebRoot,
    // retrieveRendered: false,
    verbose: true,
  });
}

function toFile(instance: ArrayBuffer) {
  fileCounter++;
  return new File([new Blob([instance])], `dicom-web.${fileCounter}.dcm`);
}

export interface FetchInstanceOptions extends FetchSeriesOptions {
  sopInstanceUID: string;
}

export async function getInstance(
  dicomWebRoot: string,
  options: FetchInstanceOptions
): Promise<File | null> {
  const client = makeClient(dicomWebRoot);
  const instance = await client.retrieveInstance(options);
  return toFile(instance);
}

const tags = {
  PatientID: '00100020',
  PatientName: '00100010',
  PatientBirthDate: '00100030',
  PatientSex: '00100040',

  StudyID: '00200010',
  StudyInstanceUID: '0020000D',
  StudyName: '00100010',
  StudyDate: '00080020',
  StudyTime: '00080030',
  AccessionNumber: '00080050',
  StudyDescription: '00081030',

  SeriesInstanceUID: '0020000E',
  SeriesNumber: '00200011',
  SeriesDescription: '0008103E',

  SopInstanceUID: '00080018',
  SopInstanceName: '0008103E',
  Modality: '00080060',
};

export type Instance = typeof tags;

function parseTag(value: any) {
  const v = value?.Value?.[0];
  const alpha = v?.Alphabetic;
  if (alpha) return alpha;
  return v;
}

function parseInstance(instance: any): Instance {
  return Object.entries(tags).reduce(
    (info, [key, tag]) => ({ ...info, [key]: parseTag(instance[tag]) }),
    {}
  ) as Instance;
}

export async function fetchAllInstances(dicomWebRoot: string) {
  const client = makeClient(dicomWebRoot);
  const instances = await client.searchForInstances();
  return instances.map(parseInstance);
}

export async function fetchSeries(
  dicomWebRoot: string,
  options: FetchSeriesOptions
): Promise<File[]> {
  const client = makeClient(dicomWebRoot);
  const series = (await client.retrieveSeries(options)) as ArrayBuffer[];
  return series.map(toFile);
}

export async function getAllSeries(dicomWebRoot: string) {
  const client = makeClient(dicomWebRoot);
  const allSeries = await client.searchForSeries();
  return allSeries.map((series) => ({
    studyName: series['00100010'].Value[0].Alphabetic,
    studyInstanceUID: series['0020000D'].Value[0],
    seriesInstanceUID: series['0020000E'].Value[0],
    seriesDescription: series['0008103E'].Value[0],
    modality: series['00080060'].Value[0],
    patientName: series['00100010'].Value[0].Alphabetic,
  }));
}

export async function getAllSeriesWithThumbnail(dicomWebRoot: string) {
  const allSeries = await getAllSeries(dicomWebRoot);
  const client = makeClient(dicomWebRoot);
  return Promise.all(
    allSeries.map(async (series) => {
      const firstInstance = parseInstance(
        (await client.retrieveSeriesMetadata(series))[0]
      );
      const thumbnail = await client.retrieveInstanceFramesRendered({
        ...firstInstance,
        frameNumbers: [1],
        mediaTypes: [{ mediaType: 'image/jpeg' }],
      });
      const arrayBufferView = new Uint8Array(thumbnail);
      const blob = new Blob([arrayBufferView], { type: 'image/jpeg' });
      const thumbnailUrl = URL.createObjectURL(blob);
      return { ...series, thumbnailUrl };
    })
  );
}

function parseInstanceMeta(instance: any) {
  return {
    studyName: instance['00100010'].Value[0].Alphabetic,
    studyInstanceUID: instance['0020000D'].Value[0],
    seriesInstanceUID: instance['0020000E'].Value[0],
    sopInstanceUID: instance['00080018'].Value[0],
    sopInstanceName: instance['0008103E'].Value[0],
  };
}

export async function fetchSeriesThumbnail(
  dicomWebRoot: string,
  series: FetchSeriesOptions
) {
  const client = makeClient(dicomWebRoot);
  const firstInstance = parseInstanceMeta(
    (await client.retrieveSeriesMetadata(series))[0]
  );
  const thumbnail = await client.retrieveInstanceFramesRendered({
    ...firstInstance,
    frameNumbers: [1],
    mediaTypes: [{ mediaType: 'image/jpeg' }],
  });
  const arrayBufferView = new Uint8Array(thumbnail);
  const blob = new Blob([arrayBufferView], { type: 'image/jpeg' });
  const thumbnailUrl = URL.createObjectURL(blob);
  return thumbnailUrl;
}
