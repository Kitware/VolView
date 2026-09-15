import { describe, expect, it } from 'vitest';
import type { RGBAColor } from '@kitware/vtk.js/types';

import { TOOL_COLORS } from '@/src/config';
import {
  cssColorToRGBA,
  tryCssColorToRGBA,
  emptyExtent,
  isEmptyExtent,
  markedExtent,
  rgbaToCssColor,
} from '@/src/segmentation/model';
import type {
  Extent3D,
  LabelmapBinding,
  SegmentMask,
  Segmentation,
} from '@/src/segmentation/model';
import { resolveSegmentAppearance } from '@/src/segmentation/segment';
import vtkLabelMap from '@/src/vtk/LabelMap';

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

describe('mask model', () => {
  it('holds no labelmap binding until voxels are allocated', () => {
    const segment: SegmentMask = {
      id: 'segment-1',
      segmentId: 'segment-1',
      representations: {},
    };

    expect(segment.representations.labelmap).toBeUndefined();
  });

  it('binds a segment to its own voxels and the box they cover', () => {
    const image = vtkLabelMap.newInstance();
    const binding: LabelmapBinding = {
      image,
      extent: [0, 9, 0, 19, 0, 29],
      name: 'Tumor',
    };
    const segment: SegmentMask = {
      id: 'segment-1',
      segmentId: 'segment-1',
      representations: { labelmap: binding },
    };

    expect(segment.representations.labelmap?.image).toBe(image);
    expect(isEmptyExtent(binding.extent)).toBe(false);
  });

  it('keeps record order separate from the records themselves', () => {
    const makeMask = (id: string, segmentId: string): SegmentMask => ({
      id,
      segmentId,
      representations: {},
    });
    const segmentation: Segmentation = {
      id: 'segmentation-1',
      name: 'Segmentation',
      parentImageId: 'image-1',
      masks: {
        'segment-1': makeMask('segment-1', 'segment-1'),
        'segment-2': makeMask('segment-2', 'segment-2'),
      },
      order: ['segment-2', 'segment-1'],
      fillOpacity: 1,
      outlineOpacity: 1,
      outlineThickness: 2,
    };

    expect(segmentation.order).toEqual(['segment-2', 'segment-1']);
    expect(Object.keys(segmentation.masks).sort()).toEqual([
      'segment-1',
      'segment-2',
    ]);
  });
});

describe('the appearance resolver', () => {
  it('fills the app defaults for what a type leaves unset', () => {
    const resolved = resolveSegmentAppearance({
      id: 'segment-1',
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
    const resolved = resolveSegmentAppearance({
      id: 'segment-1',
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
    const resolved = resolveSegmentAppearance(undefined);

    expect(resolved.name).toBe('');
    expect(resolved.fillOpacity).toBe(1);
    expect(resolved.visible).toBe(true);
    expect(resolved.locked).toBe(false);
  });

  describe('CSS colors', () => {
    // Functional notation is not supported. A config using it is told so at the
    // boundary that reads the file, rather than resolving to a plausible black.
    it.each([
      'rgb(0, 255, 0)',
      'rgb(0 255 0)',
      'rgba(255, 0, 0, 0.5)',
      'hsl(120, 100%, 50%)',
    ])('does not parse %s', (css) => {
      expect(tryCssColorToRGBA(css)).toBeUndefined();
    });

    it('treats transparent as fully transparent, not black', () => {
      expect(cssColorToRGBA('transparent')).toEqual([0, 0, 0, 0]);
    });

    it('reports unparseable input rather than silently blackening it', () => {
      expect(tryCssColorToRGBA('not-a-color')).toBeUndefined();
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

// A binding's extent is the allocation: paint pads it on growth and an erase
// never shrinks it, so the box a segment occupies has to be read off the voxels.
describe('markedExtent', () => {
  const VALUE = 3;

  // A mask bounded to `extent`, holding VALUE at each parent index in `marks`.
  const scalarsOf = (
    extent: Extent3D,
    marks: Array<[number, number, number]>
  ) => {
    const si = extent[1] - extent[0] + 1;
    const sj = extent[3] - extent[2] + 1;
    const sk = extent[5] - extent[4] + 1;
    const scalars = new Uint8Array(si * sj * sk);
    marks.forEach(([i, j, k]) => {
      scalars[
        i - extent[0] + (j - extent[2]) * si + (k - extent[4]) * si * sj
      ] = VALUE;
    });
    return scalars;
  };

  it('bounds the marked voxels, not the allocation they sit in', () => {
    const extent: Extent3D = [0, 5, 0, 5, 0, 5];
    const scalars = scalarsOf(extent, [
      [1, 2, 3],
      [4, 2, 3],
      [2, 5, 1],
    ]);

    expect(markedExtent(scalars, extent, VALUE)).toEqual([1, 4, 2, 5, 1, 3]);
  });

  it('reads a single voxel as its own box', () => {
    const extent: Extent3D = [2, 4, 2, 4, 2, 4];
    const scalars = scalarsOf(extent, [[3, 3, 3]]);

    expect(markedExtent(scalars, extent, VALUE)).toEqual([3, 3, 3, 3, 3, 3]);
  });

  it('reports an empty box for a mask holding nothing of that value', () => {
    const extent: Extent3D = [0, 3, 0, 3, 0, 3];
    const scalars = scalarsOf(extent, [[1, 1, 1]]);

    expect(isEmptyExtent(markedExtent(scalars, extent, VALUE + 1))).toBe(true);
    expect(isEmptyExtent(markedExtent(new Uint8Array(64), extent, VALUE))).toBe(
      true
    );
  });

  it('reads a mask whose own origin is not the image origin', () => {
    const extent: Extent3D = [4, 6, 7, 9, 1, 2];
    const scalars = scalarsOf(extent, [
      [5, 8, 1],
      [6, 9, 2],
    ]);

    expect(markedExtent(scalars, extent, VALUE)).toEqual([5, 6, 8, 9, 1, 2]);
  });
});
