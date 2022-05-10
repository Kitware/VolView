export { default as PaintToolManager } from './manager';

export enum BrushTypes {
  Circle = 'circle',
}

export function createBrush(type: BrushTypes) {
  switch (type) {
    case BrushTypes.Circle:
      return;
    default:
      throw new Error(`Invalid brush type given: ${type}`);
  }
}
