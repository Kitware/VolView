import { describe, expect, it } from 'vitest';
import type { RGBAColor } from '@kitware/vtk.js/types';

import { TOOL_COLORS } from '@/src/config';
import {
  cssColorToRGBA,
  tryCssColorToRGBA,
  emptyExtent,
  isEmptyExtent,
  rgbaToCssColor,
} from '@/src/types/segmentation';
import type {
  Extent3D,
  LabelmapBinding,
  Segment,
  Segmentation,
} from '@/src/types/segmentation';
import { resolveSegmentType } from '@/src/types/segmentType';

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

  it.each([
    ['orange', [255, 165, 0, 255]],
    ['rebeccapurple', [102, 51, 153, 255]],
  ])('parses the CSS color keyword %s', (name, expected) => {
    expect(cssColorToRGBA(name)).toEqual(expected);
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

describe('labelmap record model', () => {
  it('holds no labelmap binding until voxels are allocated', () => {
    const segment: Segment = {
      id: 'segment-1',
      typeId: 'type-1',
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
      typeId: 'type-1',
      representations: { labelmap: binding },
    };

    expect(segment.representations.labelmap).toEqual({
      artifactId: 'artifact-1',
      labelValue: 3,
      extent: [0, 9, 0, 19, 0, 29],
    });
    expect(isEmptyExtent(binding.extent)).toBe(false);
  });

  it('keeps record order separate from the records themselves', () => {
    const makeSegment = (id: string, typeId: string): Segment => ({
      id,
      typeId,
      representations: {},
    });
    const segmentation: Segmentation = {
      id: 'segmentation-1',
      name: 'Segmentation',
      parentImageId: 'image-1',
      segments: {
        'segment-1': makeSegment('segment-1', 'type-1'),
        'segment-2': makeSegment('segment-2', 'type-2'),
      },
      order: ['segment-2', 'segment-1'],
      fillOpacity: 1,
      outlineOpacity: 1,
      outlineThickness: 2,
    };

    expect(segmentation.order).toEqual(['segment-2', 'segment-1']);
    expect(Object.keys(segmentation.segments).sort()).toEqual([
      'segment-1',
      'segment-2',
    ]);
  });
});

describe('the appearance resolver', () => {
  it('fills the app defaults for what a type leaves unset', () => {
    const resolved = resolveSegmentType({
      id: 'type-1',
      name: 'Tumor',
      color: [255, 0, 0, 255],
      visible: true,
      locked: false,
    });

    expect(resolved).toMatchObject({
      name: 'Tumor',
      cssColor: '#ff0000',
      fillOpacity: 1,
      outlineOpacity: 1,
    });
  });

  it('keeps what a type does state', () => {
    const resolved = resolveSegmentType({
      id: 'type-1',
      name: 'Tumor',
      color: [255, 0, 0, 255],
      visible: false,
      locked: true,
      fillOpacity: 0.25,
      strokeWidth: 3,
    });

    expect(resolved.fillOpacity).toBe(0.25);
    expect(resolved.strokeWidth).toBe(3);
    expect(resolved.visible).toBe(false);
    expect(resolved.locked).toBe(true);
  });

  it('answers for a type that is gone', () => {
    const resolved = resolveSegmentType(undefined);

    expect(resolved.name).toBe('');
    expect(resolved.fillOpacity).toBe(1);
    expect(resolved.visible).toBe(true);
    expect(resolved.locked).toBe(false);
  });

  describe('functional CSS colors', () => {
    it('parses rgb and rgba, comma or space separated', () => {
      expect(cssColorToRGBA('rgb(0, 255, 0)')).toEqual([0, 255, 0, 255]);
      expect(cssColorToRGBA('rgb(0 255 0)')).toEqual([0, 255, 0, 255]);
      expect(cssColorToRGBA('rgba(255, 0, 0, 0.5)')).toEqual([255, 0, 0, 128]);
      expect(cssColorToRGBA('rgb(255 0 0 / 50%)')).toEqual([255, 0, 0, 128]);
    });

    it('parses hsl', () => {
      expect(cssColorToRGBA('hsl(120, 100%, 50%)')).toEqual([0, 255, 0, 255]);
      expect(cssColorToRGBA('hsl(0, 0%, 100%)')).toEqual([255, 255, 255, 255]);
    });

    it('treats transparent as fully transparent, not black', () => {
      expect(cssColorToRGBA('transparent')).toEqual([0, 0, 0, 0]);
    });

    it('reports unparseable input rather than silently blackening it', () => {
      expect(tryCssColorToRGBA('not-a-color')).toBeUndefined();
      expect(tryCssColorToRGBA('rgb(1, 2)')).toBeUndefined();
      expect(cssColorToRGBA('not-a-color')).toEqual([0, 0, 0, 255]);
    });

    // A config.json label color and a 6.x state file both reach here unvalidated,
    // and the migration that calls this is not wrapped in a try.
    it.each(['constructor', '__proto__', 'toString', 'valueOf'])(
      'treats the inherited property name %s as unparseable',
      (name) => {
        expect(tryCssColorToRGBA(name)).toBeUndefined();
        expect(cssColorToRGBA(name)).toEqual([0, 0, 0, 255]);
      }
    );
  });
});
