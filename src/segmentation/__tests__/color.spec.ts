import { describe, expect, it } from 'vitest';
import type { RGBAColor } from '@kitware/vtk.js/types';

import { TOOL_COLORS } from '@/src/config';
import {
  cssColorToRGBA,
  tryCssColorToRGBA,
  rgbaToCssColor,
} from '@/src/segmentation/color';

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

  it('treats transparent as fully transparent, not black', () => {
    expect(cssColorToRGBA('transparent')).toEqual([0, 0, 0, 0]);
  });
});

describe('rgbaToCssColor', () => {
  // Every existing label color, plus black and a translucent one.
  const colors: RGBAColor[] = [
    ...TOOL_COLORS.map(cssColorToRGBA),
    [0, 0, 0, 255],
    [214, 0, 0, 128],
  ];

  it.each(colors.map((rgba) => [rgba]))('round trips %j', (rgba) => {
    expect(cssColorToRGBA(rgbaToCssColor(rgba))).toEqual(rgba);
  });

  it('emits a css color literal', () => {
    expect(rgbaToCssColor([88, 242, 76, 255])).toMatch(
      /^(#[0-9a-fA-F]{6,8}|rgba?\(.+\))$/
    );
  });
});

describe('tryCssColorToRGBA', () => {
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
