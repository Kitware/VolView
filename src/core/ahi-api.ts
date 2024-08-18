import { NameToMeta } from './dicomTags';
import { dicomSliceToImageUri, nameToMetaKey } from './streaming/ahiChunkImage';

export interface FetchImageSetOptions {
  imageSet: string;
}

export interface FetchSeriesOptions extends FetchImageSetOptions {
  seriesInstanceUID: string;
}

export interface FetchInstanceOptions extends FetchSeriesOptions {
  sopInstanceUID: string;
}

export type Instance = NameToMeta & { imageSet: string };

function parseInstance(instance: any) {
  return Object.fromEntries(
    Object.entries(nameToMetaKey).map(([key, value]) => {
      return [key, instance[value]];
    })
  );
}

export async function searchForStudies(dicomWebRoot: string) {
  const setResponse = await fetch(`${dicomWebRoot}/list-image-sets`);
  const imageSetMeta = await setResponse.json();
  return imageSetMeta.map((set: any) => ({
    ...parseInstance(set),
    imageSet: set.imageSetId,
  }));
}

export async function retrieveStudyMetadata(
  dicomWebRoot: string,
  options: FetchImageSetOptions
) {
  const url = `${dicomWebRoot}/image-set/${options.imageSet}`;
  const setResponse = await fetch(url);
  const imageSetMeta = await setResponse.json();
  const patentTags = imageSetMeta.Patient.DICOM;
  const studyTags = imageSetMeta.Study.DICOM;
  const series = (
    Object.values(imageSetMeta.Study.Series) as {
      DICOM: Record<string, string>;
      Instances: Record<string, any>;
    }[]
  ).map((s) => s.DICOM);
  const instances = series.map((s) => ({ ...patentTags, ...studyTags, ...s }));
  return instances.map(parseInstance);
}

export async function retrieveSeriesMetadata(
  dicomWebRoot: string,
  options: FetchSeriesOptions
) {
  const url = `${dicomWebRoot}/image-set/${options.imageSet}`;
  const setResponse = await fetch(url);
  const imageSetMeta = await setResponse.json();
  const patentTags = imageSetMeta.Patient.DICOM;
  const studyTags = imageSetMeta.Study.DICOM;
  const series = Object.values(imageSetMeta.Study.Series) as {
    DICOM: Record<string, string>;
    Instances: Record<string, any>;
  }[];
  const instances = series.flatMap((s) => {
    return Object.values(s.Instances).map((i) => ({
      ...patentTags,
      ...studyTags,
      ...s.DICOM,
      ...i.DICOM,
    }));
  });
  return instances.map(parseInstance);
}

export async function fetchInstanceThumbnail(
  dicomWebRoot: string,
  apiParams: FetchInstanceOptions
) {
  const url = `${dicomWebRoot}/image-set/${apiParams.imageSet}`;
  const setResponse = await fetch(url);
  const imageSetMeta = await setResponse.json();
  const series = Object.values(imageSetMeta.Study.Series) as {
    DICOM: Record<string, string>;
    Instances: Record<string, any>;
  }[];
  const theSeries = series.find(
    (s) => s.DICOM.SeriesInstanceUID === apiParams.seriesInstanceUID
  );
  if (!theSeries) {
    throw new Error('Series not found');
  }
  const instanceRemote = theSeries.Instances[apiParams.sopInstanceUID];
  const id = instanceRemote.ImageFrames[0].ID;

  const request = await fetch(`${url}/${id}/pixel-data`);
  const blob = await request.blob();
  return dicomSliceToImageUri(blob);
}

const LEVELS = ['image-set'] as const;

// takes a url like http://localhost:3000/dicom-web/studies/someid/series/anotherid
// returns { host: 'http://localhost:3000/dicom-web', studies: 'someid', series: 'anotherid' }
export function parseUrl(deepDicomWebUrl: string) {
  // remove trailing slash
  const sansSlash = deepDicomWebUrl.replace(/\/$/, '');

  let paths = sansSlash.split('/');
  const parentIDs = LEVELS.reduce((idObj, dicomLevel) => {
    const [urlLevel, dicomID] = paths.slice(-2);
    if (urlLevel === dicomLevel) {
      paths = paths.slice(0, -2);
      return { [dicomLevel]: dicomID, ...idObj };
    }
    return idObj;
  }, {});

  const pathsToSlice = Object.keys(parentIDs).length * 2;
  const allPaths = sansSlash.split('/');
  const host = allPaths.slice(0, allPaths.length - pathsToSlice).join('/');

  return { host, ...parentIDs };
}
