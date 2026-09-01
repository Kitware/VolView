import { describe, expect, it } from 'vitest';
import type { RGBAColor } from '@kitware/vtk.js/types';

import { TOOL_COLORS } from '@/src/config';
import {
  cssColorToRGBA,
  emptyExtent,
  isEmptyExtent,
  rgbaToCssColor,
} from '@/src/types/segmentation';
import type {
  ActiveSegmentIntent,
  ActiveSegmentationTarget,
  Extent3D,
  LabelmapBinding,
  Segment,
  Segmentation,
} from '@/src/types/segmentation';

describe('emptyExtent', () => {
  it('is the pinned empty sentinel', () => {
    expect(emptyExtent()).toEqual([0, -1, 0, -1, 0, -1]);
  });

  it('returns a fresh extent per call', () => {
    const first = emptyExtent();
    first[1] = 10;

    expect(emptyExtent()).toEqual([0, -1, 0, -1, 0, -1]);
  });
});

describe('isEmptyExtent', () => {
  it('accepts the empty sentinel', () => {
    expect(isEmptyExtent(emptyExtent())).toBe(true);
  });

  it('rejects an extent covering a whole image', () => {
    expect(isEmptyExtent([0, 9, 0, 19, 0, 29])).toBe(false);
  });

  it('rejects a single voxel extent', () => {
    // vtk.js extents are inclusive, so min === max is one voxel, not empty.
    expect(isEmptyExtent([4, 4, 5, 5, 6, 6])).toBe(false);
  });

  it.each([
    ['i', [5, 4, 0, 9, 0, 9] as Extent3D],
    ['j', [0, 9, 5, 4, 0, 9] as Extent3D],
    ['k', [0, 9, 0, 9, 5, 4] as Extent3D],
  ])('is empty when the %s axis is inverted', (_axis, extent) => {
    expect(isEmptyExtent(extent)).toBe(true);
  });
});

describe('cssColorToRGBA', () => {
  it('parses a tool color hex string', () => {
    expect(cssColorToRGBA('#58f24c')).toEqual([88, 242, 76, 255]);
  });

  it('parses an alpha channel when present', () => {
    expect(cssColorToRGBA('#58f24c80')).toEqual([88, 242, 76, 128]);
  });

  it('parses the named color used by the vector tool label defaults', () => {
    expect(cssColorToRGBA('red')).toEqual([255, 0, 0, 255]);
  });
});

describe('rgbaToCssColor', () => {
  it.each([
    [[88, 242, 76, 255] as RGBAColor],
    [[0, 0, 0, 255] as RGBAColor],
    [[214, 0, 0, 128] as RGBAColor],
  ])('round trips %j', (rgba) => {
    expect(cssColorToRGBA(rgbaToCssColor(rgba))).toEqual(rgba);
  });

  it('emits a css color literal', () => {
    expect(rgbaToCssColor([88, 242, 76, 255])).toMatch(
      /^(#[0-9a-fA-F]{6,8}|rgba?\(.+\))$/
    );
  });
});

describe('color conversion of existing label colors', () => {
  it.each(TOOL_COLORS)('round trips %s', (css) => {
    const rgba = cssColorToRGBA(css);

    expect(cssColorToRGBA(rgbaToCssColor(rgba))).toEqual(rgba);
  });
});

describe('segment model', () => {
  it('holds no labelmap binding until voxels are allocated', () => {
    const segment: Segment = {
      id: 'segment-1',
      name: 'Tumor',
      color: [255, 0, 0, 255],
      visible: true,
      locked: false,
      representations: {},
    };

    expect(segment.representations.labelmap).toBeUndefined();
  });

  it('binds a segment to one label value inside one artifact', () => {
    const binding: LabelmapBinding = {
      artifactId: 'artifact-1',
      labelValue: 3,
      extent: [0, 9, 0, 19, 0, 29],
    };
    const segment: Segment = {
      id: 'segment-1',
      name: 'Tumor',
      color: [255, 0, 0, 255],
      visible: true,
      locked: false,
      representations: { labelmap: binding },
    };

    expect(segment.representations.labelmap).toEqual({
      artifactId: 'artifact-1',
      labelValue: 3,
      extent: [0, 9, 0, 19, 0, 29],
    });
    expect(isEmptyExtent(binding.extent)).toBe(false);
  });

  it('keeps segment order separate from the segment records', () => {
    const makeSegment = (id: string, name: string): Segment => ({
      id,
      name,
      color: [0, 0, 0, 255],
      visible: true,
      locked: false,
      representations: {},
    });
    const segmentation: Segmentation = {
      id: 'segmentation-1',
      name: 'Segmentation',
      parentImageId: 'image-1',
      segments: {
        'segment-1': makeSegment('segment-1', 'Tumor'),
        'segment-2': makeSegment('segment-2', 'Tumor'),
      },
      order: ['segment-2', 'segment-1'],
    };

    expect(segmentation.order).toEqual(['segment-2', 'segment-1']);
    expect(Object.keys(segmentation.segments).sort()).toEqual([
      'segment-1',
      'segment-2',
    ]);
  });
});

describe('active segment intent', () => {
  it('targets one segment per image', () => {
    const target: ActiveSegmentationTarget = {
      segmentationId: 'segmentation-1',
      segmentId: 'segment-1',
    };
    const intent: ActiveSegmentIntent = {
      name: 'Tumor',
      color: [255, 0, 0, 255],
      targetByImageId: {
        'image-1': target,
        'image-2': {
          segmentationId: 'segmentation-2',
          segmentId: 'segment-7',
        },
      },
    };

    expect(intent.targetByImageId['image-1']).toEqual(target);
    expect(intent.targetByImageId['image-2'].segmentId).toBe('segment-7');
  });
});
