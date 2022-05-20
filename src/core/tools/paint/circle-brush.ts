import { IPaintBrush } from './brush';

function rasterizeCircle(radius: number) {
  const imgDim = (radius - 1) * 2 + 1;
  const center = radius - 1;
  const buffer = new Uint8Array(imgDim ** 2);

  // does not check on validity of xStart and xEnd
  const blitPixels = (xStart: number, xEnd: number, y: number) => {
    const start = y * imgDim + xStart;
    const end = start + (xEnd - xStart);
    buffer.fill(1, start, end);
  };

  const plot = (x: number, y: number) => {
    blitPixels(center - x, center + x, center - y);
    blitPixels(center - x, center + x, center + y);
    blitPixels(center - y, center + y, center - x);
    blitPixels(center - y, center + y, center + x);
  };

  let x = center;
  let y = 0;
  let mid = 1 - center;

  plot(x, y);
  while (x > y) {
    y++;
    if (mid > 0) {
      // stepped out of the circle
      x--;
      mid += 2 * y - 2 * x + 1;
    } else {
      mid += 2 * y + 1;
    }
    plot(x, y);
  }

  return buffer;
}

export default class CirclePaintBrush implements IPaintBrush {
  private size: number = 1;

  setSize(size: number) {
    this.size = size;
  }

  getStamp() {
    const size = (this.size - 1) * 2 + 1;
    const stamp = rasterizeCircle(this.size);
    return {
      pixels: stamp,
      size: [size, size] as [number, number],
    };
  }
}
