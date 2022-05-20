export interface IBrushStamp {
  pixels: Uint8Array;
  size: [number, number];
}
export interface IPaintBrush {
  setSize(size: number): void;
  getStamp(): IBrushStamp;
}
