import { api } from 'dicomweb-client';

let fileCounter = 0;

export interface GetSeriesOptions {
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

export interface GetInstanceOptions extends GetSeriesOptions {
  sopInstanceUID: string;
}

export async function getInstance(
  dicomWebRoot: string,
  options: GetInstanceOptions
): Promise<File | null> {
  const client = makeClient(dicomWebRoot);
  const instance = await client.retrieveInstance(options);
  return toFile(instance);
}

function parseInstance(instance: any) {
  return {
    studyName: instance['00100010'].Value[0].Alphabetic,
    studyInstanceUID: instance['0020000D'].Value[0],
    seriesInstanceUID: instance['0020000E'].Value[0],
    sopInstanceUID: instance['00080018'].Value[0],
    sopInstanceName: instance['0008103E'].Value[0],
  };
}

export async function getAllInstances(dicomWebRoot: string) {
  const client = makeClient(dicomWebRoot);
  const instances = await client.searchForInstances();
  return instances.map(parseInstance);
}

export async function getSeries(
  dicomWebRoot: string,
  options: GetSeriesOptions
): Promise<File[] | null> {
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
