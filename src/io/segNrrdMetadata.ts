import type { SegmentGroupMetadata } from '@/src/store/segmentGroups';

const toColorString = (r: number, g: number, b: number) =>
  [r / 255, g / 255, b / 255].map((c) => c.toFixed(6)).join(' ');

/**
 * Builds Slicer-compatible .seg.nrrd metadata entries from VolView segment group metadata.
 * Returns a Map suitable for setting on an itk-wasm Image's metadata field.
 *
 * @param metadata - segment group metadata (names, colors, label values)
 * @param dimensions - [x, y, z] voxel dimensions of the labelmap
 */
export const buildSegNrrdMetadata = (
  metadata: SegmentGroupMetadata,
  dimensions: [number, number, number]
): Map<string, string> => {
  const entries = new Map<string, string>();

  entries.set('Segmentation_MasterRepresentation', 'Binary labelmap');
  entries.set('Segmentation_ContainedRepresentationNames', 'Binary labelmap|');
  entries.set('Segmentation_ReferenceImageExtentOffset', '0 0 0');

  const extentStr = `0 ${dimensions[0] - 1} 0 ${dimensions[1] - 1} 0 ${dimensions[2] - 1}`;

  metadata.segments.order.forEach((segmentValue, index) => {
    const segment = metadata.segments.byValue[segmentValue];
    if (!segment) return;

    const prefix = `Segment${index}`;
    const [r, g, b] = segment.color;

    entries.set(`${prefix}_ID`, `Segment_${segmentValue}`);
    entries.set(`${prefix}_Name`, segment.name);
    entries.set(`${prefix}_Color`, toColorString(r, g, b));
    entries.set(`${prefix}_LabelValue`, String(segmentValue));
    entries.set(`${prefix}_Layer`, '0');
    entries.set(`${prefix}_Extent`, extentStr);
    entries.set(`${prefix}_Tags`, '|');
  });

  return entries;
};

export const maybeBuildSegNrrdMetadata = (
  format: string,
  segMetadata: SegmentGroupMetadata,
  dimensions: [number, number, number]
): Map<string, string> | undefined =>
  format === 'seg.nrrd'
    ? buildSegNrrdMetadata(segMetadata, dimensions)
    : undefined;
