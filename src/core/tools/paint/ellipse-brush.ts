import { Vector2 } from '@kitware/vtk.js/types';
import { IBrushStencil, IPaintBrush } from './brush';

// Adapted from http://members.chello.at/easyfilter/bresenham.html
function rasterizeEllipse(xdiam: number, ydiam: number) {
  const buffer = new Uint8Array(xdiam * ydiam);

  const putPixel = (x: number, y: number) => {
    buffer[x + y * xdiam] = 1;
  };

  const blitLine = (x0: number, x1: number, y: number) => {
    const start = y * xdiam + x0;
    const end = start + (x1 - x0 + 1);
    buffer.fill(1, start, end);
  };

  let x0 = 0;
  let y0 = 0;
  let x1 = xdiam - 1;
  let y1 = ydiam - 1;

  let a = x1;
  let b = y1;
  // eslint-disable-next-line no-bitwise
  const b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  let e2 = 0;

  y0 += Math.floor((b + 1) / 2);
  y1 = y0 - b1;
  a *= 8 * a;
  b *= 8 * b;
  do {
    blitLine(x0, x1, y0);
    blitLine(x0, x1, y1);
    e2 = 2 * err;
    if (e2 <= dy) {
      y0++;
      y1--;
      dy += a;
      err += dy;
    }
    if (e2 >= dx || 2 * err > dy) {
      x0++;
      x1--;
      dx += b;
      err += dx;
    }
  } while (x0 <= x1);
  while (y0 - y1 < ydiam) {
    putPixel(x0 - 1, y0);
    putPixel(x1 + 1, y0++);
    putPixel(x0 - 1, y1);
    putPixel(x1 + 1, y1--);
  }

  return buffer;
}

export default class EllipsePaintBrush implements IPaintBrush {
  private size: number = 1;
  private scale: Vector2 = [1, 1];
  private cachedStencil!: IBrushStencil;

  constructor() {
    this.recomputeStencil();
  }

  setSize(size: number) {
    this.size = Math.max(0, size);
    this.recomputeStencil();
  }

  setScale(scale: Vector2) {
    this.scale = scale;
    this.recomputeStencil();
  }

  private recomputeStencil() {
    const scaledSize = [
      Math.ceil(this.size * this.scale[0]),
      Math.ceil(this.size * this.scale[1]),
    ] as Vector2;
    this.cachedStencil = {
      size: scaledSize,
      pixels: rasterizeEllipse(scaledSize[0], scaledSize[1]),
    };
  }

  getStencil() {
    return this.cachedStencil;
  }
}
