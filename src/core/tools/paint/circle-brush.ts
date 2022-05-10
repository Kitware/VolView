import { IPaintBrush } from './brush';

export default class CirclePaintBrush implements IPaintBrush {
  private radius: number = 1;

  constructor(radius?: number) {
    if (radius !== undefined) {
      this.radius = radius;
    }
  }

  setRadius(radius: number) {
    this.radius = radius;
  }
}
