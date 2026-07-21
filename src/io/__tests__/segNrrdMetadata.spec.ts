import { describe, it, expect } from 'vitest';

import {
  buildSegNrrdMetadata,
  maybeBuildSegNrrdMetadata,
  parseSegNrrdMetadata,
  overlaySegmentMetadata,
  type ParsedSegment,
  type DecodedSegment,
} from '@/src/io/segNrrdMetadata';
import type { SegmentGroupMetadata } from '@/src/store/segmentGroups';

// ---------------------------------------------------------------------------
// Serialization "round-trips segment names/colors".
//
// `writeSegmentation('seg.nrrd', …)` embeds the segment names/colors by handing
// this metadata Map to the NRRD writer (readWriteImage.ts). The ITK-wasm write
// itself needs a web worker + wasm the happy-dom unit env cannot run, so the
// faithful, hermetic proof is at the metadata-embedding layer that DECIDES what
// gets written: the names/colors are embedded under the LITERAL 'seg.nrrd'
// format token, and dropped for any other token. That format-token gate is the
// load-bearing gotcha — passing 'nrrd' would silently ship a labelmap with no
// segment names/colors.
// ---------------------------------------------------------------------------

const metadata: SegmentGroupMetadata = {
  name: 'Tumor group',
  parentImage: 'img-1',
  segments: {
    order: [1, 2],
    byValue: {
      1: {
        value: 1,
        name: 'Tumor',
        color: [255, 0, 0, 255],
        visible: true,
        locked: false,
      },
      2: {
        value: 2,
        name: 'Edema',
        color: [0, 128, 255, 255],
        visible: true,
        locked: false,
      },
    },
  },
};

const dims: [number, number, number] = [4, 4, 2];

describe('buildSegNrrdMetadata embeds segment names + colors', () => {
  it('writes a Name / Color / LabelValue entry per segment, in order', () => {
    const m = buildSegNrrdMetadata(metadata, dims);

    // Segment 0 (label value 1) — pure red.
    expect(m.get('Segment0_Name')).toBe('Tumor');
    expect(m.get('Segment0_Color')).toBe('1.000000 0.000000 0.000000');
    expect(m.get('Segment0_LabelValue')).toBe('1');

    // Segment 1 (label value 2) — 128/255 → 0.501961, 255/255 → 1.
    expect(m.get('Segment1_Name')).toBe('Edema');
    expect(m.get('Segment1_Color')).toBe('0.000000 0.501961 1.000000');
    expect(m.get('Segment1_LabelValue')).toBe('2');
  });

  it('stamps the Slicer segmentation representation + extent from dimensions', () => {
    const m = buildSegNrrdMetadata(metadata, dims);
    expect(m.get('Segmentation_MasterRepresentation')).toBe('Binary labelmap');
    // extent = 0..dim-1 per axis.
    expect(m.get('Segment0_Extent')).toBe('0 3 0 3 0 1');
  });
});

describe('maybeBuildSegNrrdMetadata gates on the exact seg.nrrd token', () => {
  it('embeds names/colors ONLY for the literal "seg.nrrd" format', () => {
    const m = maybeBuildSegNrrdMetadata('seg.nrrd', metadata, dims);
    expect(m).toBeInstanceOf(Map);
    expect(m?.get('Segment0_Name')).toBe('Tumor');
    expect(m?.get('Segment1_Name')).toBe('Edema');
  });

  it('drops the metadata for any other token (the load-bearing gotcha)', () => {
    // Passing 'nrrd' (or 'nii.gz', 'vti', …) silently omits segment names/colors
    // — must serialize with 'seg.nrrd', never saveFormat's 'vti' default.
    expect(maybeBuildSegNrrdMetadata('nrrd', metadata, dims)).toBeUndefined();
    expect(maybeBuildSegNrrdMetadata('nii.gz', metadata, dims)).toBeUndefined();
    expect(maybeBuildSegNrrdMetadata('vti', metadata, dims)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Read side: parseSegNrrdMetadata is the faithful inverse of the
// writer — a labelmap produced by a backend CLI arrives with its real
// names/colors, not the default numbering.
// ---------------------------------------------------------------------------

describe('parseSegNrrdMetadata recovers segment descriptors from header metadata', () => {
  it('round-trips buildSegNrrdMetadata: names, label values, colors back to 0–255', () => {
    const parsed = parseSegNrrdMetadata(buildSegNrrdMetadata(metadata, dims));
    expect(parsed).toEqual([
      { value: 1, name: 'Tumor', color: [255, 0, 0, 255], visible: true },
      // 0.501961 → round(0.501961*255) = 128; 1.000000 → 255.
      { value: 2, name: 'Edema', color: [0, 128, 255, 255], visible: true },
    ]);
  });

  it('parses the exact key spelling the client writer emits (hand-written map)', () => {
    const m = new Map<string, string>([
      ['Segment0_Name', 'Region 1 (lowest)'],
      ['Segment0_Color', '0.905882 0.298039 0.235294'],
      ['Segment0_LabelValue', '1'],
    ]);
    expect(parseSegNrrdMetadata(m)).toEqual([
      {
        value: 1,
        name: 'Region 1 (lowest)',
        color: [231, 76, 60, 255],
        visible: true,
      },
    ]);
  });

  it('returns undefined when no Segment* metadata is present (default fallback)', () => {
    expect(parseSegNrrdMetadata(new Map())).toBeUndefined();
    expect(
      parseSegNrrdMetadata(new Map([['ITK_InputFilterName', 'NrrdImageIO']]))
    ).toBeUndefined();
  });

  it('recovers a segment past a header gap (no zero-based contiguity assumption)', () => {
    // A foreign / hand-edited header may leave gaps between indices. Every
    // present Segment{N}_ block must be recovered, not just the leading run.
    const m = buildSegNrrdMetadata(metadata, dims); // Segment0, Segment1
    m.set('Segment5_Name', 'orphan'); // gap at 2..4 — must still be reached
    m.set('Segment5_LabelValue', '9');
    m.set('Segment5_Color', '0 0 0');
    const parsed = parseSegNrrdMetadata(m)!;
    expect(parsed.map((s) => s.value)).toEqual([1, 2, 9]);
    expect(parsed.find((s) => s.value === 9)?.name).toBe('orphan');
  });

  it('recovers a header that starts at Segment1 (1-based, no Segment0)', () => {
    const m = new Map<string, string>([
      ['Segment1_Name', 'Liver'],
      ['Segment1_Color', '0.905882 0.298039 0.235294'],
      ['Segment1_LabelValue', '1'],
      ['Segment2_Name', 'Spleen'],
      ['Segment2_Color', '0 0.501961 1'],
      ['Segment2_LabelValue', '2'],
    ]);
    expect(parseSegNrrdMetadata(m)).toEqual([
      { value: 1, name: 'Liver', color: [231, 76, 60, 255], visible: true },
      { value: 2, name: 'Spleen', color: [0, 128, 255, 255], visible: true },
    ]);
  });

  it('recovers both sides of an intermediate gap (Segment0 + Segment2)', () => {
    const m = new Map<string, string>([
      ['Segment0_Name', 'A'],
      ['Segment0_Color', '1 0 0'],
      ['Segment0_LabelValue', '1'],
      ['Segment2_Name', 'C'],
      ['Segment2_Color', '0 0 1'],
      ['Segment2_LabelValue', '3'],
    ]);
    const parsed = parseSegNrrdMetadata(m)!;
    expect(parsed.map((s) => s.value)).toEqual([1, 3]);
    expect(parsed.map((s) => s.name)).toEqual(['A', 'C']);
    expect(parsed.find((s) => s.value === 3)?.color).toEqual([0, 0, 255, 255]);
  });

  it('clamps out-of-range color channels to [0,255] (defensive vs foreign files)', () => {
    // 1.5*255→383→clamp 255; -0.2*255→-51→clamp 0; 0.5*255→128.
    const m = new Map<string, string>([
      ['Segment0_Name', 'weird'],
      ['Segment0_Color', '1.5 -0.2 0.5'],
      ['Segment0_LabelValue', '1'],
    ]);
    expect(parseSegNrrdMetadata(m)).toEqual([
      { value: 1, name: 'weird', color: [255, 0, 128, 255], visible: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// overlaySegmentMetadata (issue #6): the full voxel enumeration is the spine so
// a labelled voxel the header does NOT describe still gets a manageable segment,
// with embedded names/colors overlaid on top.
// ---------------------------------------------------------------------------

describe('overlaySegmentMetadata merges embedded metadata over the enumeration', () => {
  const mkDefault = (value: number): DecodedSegment => ({
    value,
    name: `default ${value}`,
    color: [10, 20, 30, 255],
    visible: true,
  });

  it('keeps a default for every labelled voxel the header does NOT describe (#6)', () => {
    const described: ParsedSegment[] = [
      { value: 1, name: 'Region 1', color: [231, 76, 60, 255], visible: true },
    ];
    expect(overlaySegmentMetadata([1, 2, 3], described, mkDefault)).toEqual([
      { value: 1, name: 'Region 1', color: [231, 76, 60, 255], visible: true },
      { value: 2, name: 'default 2', color: [10, 20, 30, 255], visible: true },
      { value: 3, name: 'default 3', color: [10, 20, 30, 255], visible: true },
    ]);
  });

  it('overrides the default name/color/visibility for a described value', () => {
    const described: ParsedSegment[] = [
      { value: 1, name: 'Named', color: [1, 2, 3, 255], visible: false },
    ];
    expect(overlaySegmentMetadata([1], described, mkDefault)).toEqual([
      { value: 1, name: 'Named', color: [1, 2, 3, 255], visible: false },
    ]);
  });

  it('falls back to pure defaults when there is no embedded metadata', () => {
    expect(overlaySegmentMetadata([1, 2], undefined, mkDefault)).toEqual([
      { value: 1, name: 'default 1', color: [10, 20, 30, 255], visible: true },
      { value: 2, name: 'default 2', color: [10, 20, 30, 255], visible: true },
    ]);
  });

  it('appends a described value outside the enumeration and skips background 0', () => {
    const described: ParsedSegment[] = [
      { value: 1, name: 'in', color: [1, 1, 1, 255], visible: true },
      { value: 7, name: 'outside', color: [2, 2, 2, 255], visible: true },
      { value: 0, name: 'bg', color: [0, 0, 0, 255], visible: true },
    ];
    const merged = overlaySegmentMetadata([1], described, mkDefault);
    expect(merged.map((s) => s.value)).toEqual([1, 7]); // 0 skipped, 7 appended
    expect(merged.find((s) => s.value === 7)?.name).toBe('outside');
  });

  it('does NOT duplicate an out-of-enumeration value described twice (dedup)', () => {
    // A foreign / hand-edited header with two Segment blocks sharing a LabelValue
    // outside the voxel range must yield ONE segment (last-wins), not two rows
    // with a colliding `order`/Vue `:key`.
    const described: ParsedSegment[] = [
      { value: 200, name: 'first', color: [1, 1, 1, 255], visible: true },
      { value: 200, name: 'second', color: [2, 2, 2, 255], visible: true },
    ];
    const merged = overlaySegmentMetadata([1, 2, 3], described, mkDefault);
    expect(merged.map((s) => s.value)).toEqual([1, 2, 3, 200]); // 200 once
    expect(merged.find((s) => s.value === 200)?.name).toBe('second'); // last wins
  });
});
