/* global __VERSIONS__, __GIT_SHORT_SHA__ */

import { useDatasetStore } from '@/src/store/datasets';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';

const MAX_ERROR_LENGTH = 4000;

const COMPOUND_EXTENSIONS = ['nii.gz', 'iwi.cbor', 'seg.nrrd'];

const parseBrowserInfo = (): string => {
  if (typeof navigator === 'undefined') return 'unknown';

  const { userAgent: ua } = navigator;

  const patterns: [string, RegExp][] = [
    ['Firefox', /Firefox\/([\d.]+)/],
    ['Edge', /Edg\/([\d.]+)/],
    ['Chrome', /Chrome\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
  ];

  const match = patterns
    .map(([name, re]) => {
      const m = ua.match(re);
      return m ? `${name} ${m[1]}` : null;
    })
    .find(Boolean);

  const browser = match ?? 'Unknown';

  const os = ['Windows', 'Mac', 'Linux', 'Android', 'iPhone', 'iPad'].find(
    (name) => ua.includes(name)
  );

  const osLabel =
    os === 'Mac'
      ? 'macos'
      : os === 'iPhone' || os === 'iPad'
        ? 'ios'
        : (os?.toLowerCase() ?? 'unknown');

  return `${browser} (${osLabel})`;
};

const getSourceFormat = (name: string, isDicom: boolean): string => {
  if (isDicom) return 'DICOM';
  const lower = name.toLowerCase();
  const compound = COMPOUND_EXTENSIONS.find((ext) => lower.endsWith(`.${ext}`));
  if (compound) return compound;
  const lastDot = name.lastIndexOf('.');
  return lastDot >= 0 ? name.slice(lastDot + 1).toLowerCase() : 'unknown';
};

const formatScalarType = (constructorName: string): string =>
  constructorName.replace('Array', '');

const formatError = (error: unknown): string => {
  if (!error) return 'No error details available';
  const text =
    error instanceof Error ? (error.stack ?? String(error)) : String(error);
  return text.length > MAX_ERROR_LENGTH
    ? `${text.slice(0, MAX_ERROR_LENGTH)}\n... (truncated)`
    : text;
};

const collectDatasetInfo = (): string[] => {
  const datasetStore = useDatasetStore();
  const imageCacheStore = useImageCacheStore();
  const dicomStore = useDICOMStore();
  const segmentGroupStore = useSegmentGroupStore();

  return datasetStore.idsAsSelections.map((id, i) => {
    const metadata = imageCacheStore.getImageMetadata(id);
    const imageData = imageCacheStore.getVtkImageData(id);

    const dims = metadata
      ? Array.from(metadata.dimensions).join('\u00d7')
      : 'unknown';

    const scalars = imageData?.getPointData().getScalars()?.getData();
    const dataType = scalars
      ? formatScalarType(scalars.constructor.name)
      : 'unknown';

    const isDicom = id in dicomStore.volumeInfo;
    const sourceFormat = metadata
      ? getSourceFormat(metadata.name, isDicom)
      : isDicom
        ? 'DICOM'
        : 'unknown';

    const segCount = segmentGroupStore.orderByParent[id]?.length ?? 0;
    const segPart = segCount > 0 ? ` (segment groups: ${segCount})` : '';

    return `  [${i}] ${dims} ${dataType} from ${sourceFormat}${segPart}`;
  });
};

export const generateBugReport = (error: unknown): string => {
  const versions = __VERSIONS__;
  const sha = __GIT_SHORT_SHA__;

  const lines = [
    '--- VolView Bug Report ---',
    `Build: volview ${versions.volview} (${sha}) | vtk.js: ${versions['vtk.js']}, itk-wasm: ${versions['itk-wasm']}`,
    `Browser: ${parseBrowserInfo()}`,
    '',
    'Error:',
    formatError(error),
  ];

  try {
    const datasets = collectDatasetInfo();
    const segmentGroupStore = useSegmentGroupStore();

    lines.push('', `Datasets: ${datasets.length}`);
    lines.push(...datasets);
    lines.push(`Save format: ${segmentGroupStore.saveFormat}`);
  } catch {
    lines.push('', 'Datasets: unavailable');
  }

  lines.push('--- End Report ---');

  return lines.join('\n');
};
