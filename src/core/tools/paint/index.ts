import vtkLabelMap from '@/src/vtk/LabelMap';
import vtkPaintWidget from '@/src/vtk/PaintWidget';
import type { Vector2 } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';
import { Maybe } from '@/src/types';
import { IPaintBrush } from './brush';
import EllipsePaintBrush from './ellipse-brush';

export const ERASE_BRUSH_VALUE = 0;

export enum PaintMode {
  CirclePaint,
  Erase,
  FillBetween,
}

export default class PaintTool {
  readonly factory: vtkPaintWidget;
  private mode: PaintMode;
  private brush: IPaintBrush;
  private brushValue: Maybe<number>;

  constructor() {
    this.factory = vtkPaintWidget.newInstance();
    this.brush = new EllipsePaintBrush();
    this.brushValue = 1;
    this.mode = PaintMode.CirclePaint;
  }

  private updateWidgetStencil() {
    // use unscaled stencil for paint outline
    const stencil = this.brush.getStencil();
    const widgetState = this.factory.getWidgetState();
    widgetState.setStencil(stencil);
  }

  setBrushSize(size: number) {
    this.brush.setSize(size);
    this.updateWidgetStencil();
  }

  setBrushScale(scale: Vector2) {
    this.brush.setScale(scale);
    this.updateWidgetStencil();
  }

  setMode(mode: PaintMode) {
    this.mode = mode;
  }

  /**
   * Sets the brush value.
   *
   * If the brush value is null | undefined, then no paint will occur.
   * @param value
   */
  setBrushValue(value: Maybe<number>) {
    this.brushValue = value;
  }

  /**
   * Adds paint to a labelmap.
   *
   * If endPoint is specified, then linearly interpolates the brush
   * from the start to the end.
   *
   * Assumption: startPoint and endPoint are on the same slice axis.
   *
   * @param labelmap paint in this labelmap
   * @param sliceAxis Which index-space axis to paint on (0, 1, or 2).
   * @param startPoint start point
   * @param endPoint ending point (optional)
   */
  paintLabelmap(
    labelmap: vtkLabelMap,
    sliceAxis: 0 | 1 | 2,
    startPoint: vec3,
    endPoint?: vec3
  ) {
    const inBrushingMode =
      this.mode === PaintMode.CirclePaint || this.mode === PaintMode.Erase;
    if (this.brushValue == null || !inBrushingMode) return;

    const brushValue =
      this.mode === PaintMode.Erase ? ERASE_BRUSH_VALUE : this.brushValue;
    const stencil = this.brush.getStencil();

    const start = [
      // transforms + floating point errors can make zero values occasionally
      // turn into really tiny negative values
      ...startPoint.map((val) => Math.round(val)),
    ];
    // Assumption: startPoint and endPoint are on the same slice axis.
    const ijkSlice = start[sliceAxis];
    start.splice(sliceAxis, 1);

    let end = [...start];
    if (endPoint) {
      end = [...endPoint.map((val) => Math.round(val))];
      end.splice(sliceAxis, 1);
    }

    const labelmapPixels = labelmap.getPointData().getScalars().getData();
    const labelmapDims = labelmap.getDimensions();
    const jStride = labelmapDims[0];
    const kStride = labelmapDims[0] * labelmapDims[1];

    const isInBounds = (point: number[]) =>
      point[0] >= 0 &&
      point[1] >= 0 &&
      point[2] >= 0 &&
      point[0] < labelmapDims[0] &&
      point[1] < labelmapDims[1] &&
      point[2] < labelmapDims[2];

    const { pixels, size } = stencil;
    const centerX = Math.floor((size[0] - 1) / 2);
    const centerY = Math.floor((size[1] - 1) / 2);

    const point1 = [...start];
    const point2 = [...end];
    const rounded = [0, 0, 0];
    const curPoint: number[] = [0, 0];
    for (let y = 0; y < size[1]; y++) {
      const ydelta = y - centerY;
      const yoffset = y * size[0];
      for (let x = 0; x < size[0]; x++) {
        const xdelta = x - centerX;
        const pixelOffset = yoffset + x;
        if (pixels[pixelOffset]) {
          point1[0] = start[0] + xdelta;
          point1[1] = start[1] + ydelta;
          point2[0] = end[0] + xdelta;
          point2[1] = end[1] + ydelta;

          // line between the two points
          const dx = point2[0] - point1[0];
          const dy = point2[1] - point1[1];
          let steps = Math.abs(Math.abs(dx) > Math.abs(dy) ? dx : dy);
          const incX = dx / steps;
          const incY = dy / steps;
          [curPoint[0], curPoint[1]] = point1;
          while (steps-- >= 0) {
            // add slice axis to make a proper 3D index
            curPoint.splice(sliceAxis, 0, ijkSlice);
            rounded[0] = Math.round(curPoint[0]);
            rounded[1] = Math.round(curPoint[1]);
            rounded[2] = Math.round(curPoint[2]);

            if (isInBounds(rounded)) {
              const offset =
                rounded[0] + rounded[1] * jStride + rounded[2] * kStride;
              labelmapPixels[offset] = brushValue;
            }

            // undo adding the slice axis value
            curPoint.splice(sliceAxis, 1);

            curPoint[0] += incX;
            curPoint[1] += incY;
          }
        }
      }
    }

    labelmap.modified();
  }
}
