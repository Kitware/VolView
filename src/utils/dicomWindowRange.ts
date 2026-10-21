import { Tags } from '@/src/core/dicomTags';

type DicomMetadata = Iterable<readonly [string, string]> | null | undefined;

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const parseValues = (value?: string) =>
  value
    ?.split('\\')
    .map((token) => (decimal.test(token.trim()) ? Number(token) : NaN)) ?? [];

function readWindow(metadata: DicomMetadata) {
  if (!metadata) return undefined;
  const tags = Object.fromEntries(metadata);
  const centers = parseValues(tags[Tags.WindowLevel]);
  const widths = parseValues(tags[Tags.WindowWidth]);
  const voiFunction =
    tags[Tags.VOILUTFunction]?.trim().toUpperCase() || 'LINEAR';
  if (
    !centers.length ||
    centers.length !== widths.length ||
    !centers.every(Number.isFinite) ||
    !widths.every((width) => Number.isFinite(width) && width > 0) ||
    !['LINEAR', 'LINEAR_EXACT'].includes(voiFunction)
  )
    return undefined;
  return { center: centers[0], width: widths[0], voiFunction };
}

export function getConsistentDicomWindowRange(
  metadata: readonly DicomMetadata[]
): [number, number] | undefined {
  const windows = metadata.map(readWindow);
  const first = windows[0];
  if (
    !first ||
    !windows.every(
      (window) =>
        window?.center === first.center &&
        window.width === first.width &&
        window.voiFunction === first.voiFunction
    )
  )
    return undefined;
  // DICOM LINEAR has half-value offsets; LINEAR_EXACT uses the full width.
  const offset = first.voiFunction === 'LINEAR' ? 1 : 0;
  const center = first.center - offset / 2;
  const halfWidth = (first.width - offset) / 2;
  const min = center - halfWidth;
  const max = center + halfWidth;
  return Number.isFinite(min) &&
    Number.isFinite(max) &&
    min < max &&
    Number.isFinite(max - min)
    ? [min, max]
    : undefined;
}
