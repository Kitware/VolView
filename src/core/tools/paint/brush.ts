import { Vector2 } from '@kitware/vtk.js/types';

export interface IBrushStencil {
  pixels: Uint8Array;
  size: [number, number];
}
export interface IPaintBrush {
  /**
   * Sets the size of the stencil, pre-scaling.
   */
  setSize(size: number): void;
  /**
   * Sets the scale of the stencil.
   */
  setScale(scale: Vector2): void;
  /**
   * Returns the stencil with the applied scaling.
   */
  getStencil(): IBrushStencil;
}
