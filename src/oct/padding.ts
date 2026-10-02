import type { DataSet } from 'dicom-parser';
import { Tags } from '@/src/core/dicomTags';

export const OCT_PADDING_ERROR = 'oct:padding-error';
const paddingTags = [Tags.PixelPaddingValue, Tags.PixelPaddingRangeLimit];
const invalid =
  'OCT pixel padding cannot be interpreted reliably; en face projection is unavailable.';

function declaredNumber(
  tags: Map<string, string>,
  tag: string,
  fallback?: number
) {
  if (!tags.has(tag)) return fallback;
  const text = tags.get(tag)?.trim();
  return text ? Number(text) : NaN;
}

function storedFormat(tags: Map<string, string>) {
  const bits = declaredNumber(tags, Tags.BitsStored);
  const signed = declaredNumber(tags, Tags.PixelRepresentation);
  if (!Number.isInteger(bits) || !bits || bits < 1 || bits > 32) return null;
  if (signed !== 0 && signed !== 1) return null;
  return {
    minimum: signed ? -(2 ** (bits - 1)) : 0,
    maximum: 2 ** (bits - signed) - 1,
  };
}

function storedPadding(tags: Map<string, string>) {
  const first = declaredNumber(tags, Tags.PixelPaddingValue);
  const last = declaredNumber(tags, Tags.PixelPaddingRangeLimit, first);
  const format = storedFormat(tags);
  if (!format || !Number.isInteger(first) || !Number.isInteger(last))
    return null;
  if (
    first! < format.minimum ||
    first! > format.maximum ||
    last! < format.minimum ||
    last! > format.maximum
  )
    return null;
  return [Math.min(first!, last!), Math.max(first!, last!)];
}

function paddingNeighborsCollide(
  tags: Map<string, string>,
  stored: number[],
  transform: { slope: number; intercept: number },
  range: { min: number; max: number }
) {
  const format = storedFormat(tags)!;
  const neighbors = [];
  if (stored[0] > format.minimum) neighbors.push(stored[0] - 1);
  if (stored[1] < format.maximum) neighbors.push(stored[1] + 1);
  return neighbors.some((value) => {
    const decoded = value * transform.slope + transform.intercept;
    return decoded >= range.min && decoded <= range.max;
  });
}

function decodedPadding(tags: Map<string, string>) {
  const stored = storedPadding(tags);
  const slope = declaredNumber(tags, Tags.RescaleSlope, 1)!;
  const intercept = declaredNumber(tags, Tags.RescaleIntercept, 0)!;
  if (
    !stored ||
    !Number.isFinite(slope) ||
    slope === 0 ||
    !Number.isFinite(intercept)
  )
    return null;
  const endpoints = stored.map((value) => value * slope + intercept);
  if (!endpoints.every(Number.isFinite)) return null;
  const range = { min: Math.min(...endpoints), max: Math.max(...endpoints) };
  return paddingNeighborsCollide(tags, stored, { slope, intercept }, range)
    ? null
    : range;
}

function hasPadding(tags: Map<string, string>) {
  return paddingTags.some((tag) => tags.has(tag));
}

function paddingForChunk(tags: Map<string, string>) {
  const error = tags.get(OCT_PADDING_ERROR);
  if (error) return { range: null, reason: error };
  if (!hasPadding(tags)) return { range: null, reason: null };
  const range = decodedPadding(tags);
  return { range, reason: range ? null : invalid };
}

type PaddingRange = {
  firstFrame: number;
  lastFrame: number;
  min: number;
  max: number;
};

function appendRange(ranges: PaddingRange[], next: PaddingRange) {
  const previous = ranges.at(-1);
  if (
    previous &&
    previous.lastFrame + 1 === next.firstFrame &&
    previous.min === next.min &&
    previous.max === next.max
  )
    previous.lastFrame = next.lastFrame;
  else ranges.push(next);
}

/** Declared stored padding is mapped to the decoded modality scalar domain. */
export function octPadding(
  metadata: readonly Iterable<[string, string]>[],
  frameCount: number
) {
  const declarations = metadata.map((entry) => paddingForChunk(new Map(entry)));
  const ranges: PaddingRange[] = [];
  const error = declarations.find(({ reason }) => reason);
  if (error) return { ranges, reason: error.reason };
  if (!declarations.some(({ range }) => range)) return { ranges, reason: null };
  if (
    !Number.isInteger(frameCount) ||
    frameCount < 1 ||
    (metadata.length > 1 && frameCount !== metadata.length)
  )
    return { ranges, reason: invalid };
  declarations.forEach(({ range }, index) => {
    if (!range) return;
    appendRange(ranges, {
      firstFrame: metadata.length === 1 ? 0 : index,
      lastFrame: metadata.length === 1 ? frameCount - 1 : index,
      ...range,
    });
  });
  return { ranges, reason: null };
}

function paddingValue(data: DataSet, tag: string, signed: boolean) {
  const key = 'x' + tag.replace('|', '');
  const element = data.elements[key];
  if (!element) return undefined;
  if (
    element.length !== 2 ||
    (element.vr && element.vr !== (signed ? 'SS' : 'US'))
  )
    return null;
  return signed ? data.int16(key) : data.uint16(key);
}

function ambiguousTransform(data: DataSet) {
  const shared = data.elements.x52009229?.items ?? [];
  const frames = data.elements.x52009230?.items ?? [];
  return (
    !!data.elements.x00283000 ||
    !!data.elements.x00289145 ||
    [...shared, ...frames].some((item) => !!item.dataSet?.elements.x00289145)
  );
}

/** Parse binary signed/unsigned padding tags without relying on text tag readers. */
export function augmentOCTPadding(data: DataSet, tags: Map<string, string>) {
  const declared = paddingTags.some(
    (tag) => data.elements['x' + tag.replace('|', '')] || tags.has(tag)
  );
  if (!declared) return;
  const signed = data.uint16('x00280103') === 1;
  for (const tag of paddingTags) {
    const value = paddingValue(data, tag, signed);
    if (value === null) tags.set(OCT_PADDING_ERROR, invalid);
    else if (value !== undefined) tags.set(tag, String(value));
  }
  if (ambiguousTransform(data))
    tags.set(
      OCT_PADDING_ERROR,
      'This OCT combines pixel padding with an unsupported modality transformation; en face projection is unavailable.'
    );
}
