import { IPaintBrush } from './brush';

function rasterizeCircle(radius: number) {
  const imgDim = (radius - 1) * 2 + 1;
  const center = radius - 1;
  const buffer = new Uint8Array(imgDim ** 2);

  const putPixel = (x: number, y: number) => {
    buffer[y * imgDim + x] = 1;
  };

  const plot = (x: number, y: number) => {
    for (let xi = center - x; xi <= center + x; xi++) {
      putPixel(xi, center - y);
      putPixel(xi, center + y);
    }

    for (let xi = center - y; xi <= center + y; xi++) {
      putPixel(xi, center - x);
      putPixel(xi, center + x);
    }
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
