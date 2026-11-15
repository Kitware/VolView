import type { DicomDataset } from '../../metadata/dicomDataset';
import { datasetFromTags } from '@/tests/dicomDataset';

export const tags = (values: Record<string, string>) =>
  datasetFromTags(Object.entries(values));

export function sequence(tag: string, items: DicomDataset[]) {
  return {
    tag,
    group: parseInt(tag.slice(0, 4), 16),
    element: parseInt(tag.slice(4), 16),
    vr: 'SQ',
    values: { kind: 'sequence' as const, items },
  };
}

export const groups = (
  items: Array<ReturnType<typeof sequence>>
): DicomDataset => ({
  specificCharacterSet: null,
  elements: items,
});

/** An enhanced multiframe header: shared groups, one per-frame group per frame. */
export function enhanced(
  shared: DicomDataset,
  frames: DicomDataset[],
  root: Record<string, string> = {}
): DicomDataset {
  const header = tags({
    '00280010': '2',
    '00280011': '2',
    '00280008': String(frames.length),
    '00280101': '16',
    ...root,
  });
  return {
    ...header,
    elements: [
      ...header.elements,
      sequence('52009229', [shared]),
      sequence('52009230', frames),
    ],
  };
}

export const positioned = (position: string) =>
  groups([sequence('00209113', [tags({ '00200032': position })])]);

export const ctShared = () =>
  groups([
    sequence('00289110', [tags({ '00280030': '.388672\\.388672' })]),
    sequence('00209116', [tags({ '00200037': '-1\\0\\0\\0\\1\\0' })]),
    sequence('00289145', [tags({ '00281052': '-1024', '00281053': '1' })]),
  ]);

/** Two frames at one position that differ only in Temporal Position Index. */
export function sharedPlaneTemporal() {
  const shared = ctShared();
  shared.elements.push(
    sequence('00209113', [tags({ '00200032': '10\\20\\30' })])
  );
  return enhanced(
    shared,
    [1, 2].map((time) =>
      groups([sequence('00209111', [tags({ '00209128': String(time) })])])
    )
  );
}
