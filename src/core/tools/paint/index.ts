import vtkLabelMap from '@/src/vtk/LabelMap';
import vtkPaintWidget from '@/src/vtk/PaintWidget';
import type { Vector2 } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';
import { Maybe } from '@/src/types';
import type { Extent3D } from '@/src/segmentation/geometry';
import { IPaintBrush } from './brush';
import EllipsePaintBrush from './ellipse-brush';

export const ERASE_BRUSH_VALUE = 0;

export enum PaintMode {
  CirclePaint,
  Erase,
  Process,
  Eyedropper,
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
   * The index-space box a stroke can touch, in whatever space its points are
   * given in. Bounded storage has to be grown to cover the stroke before the
   * brush runs, and this states the region from the same stencil the brush
   * writes through.
   */
  strokeBounds(
    sliceAxis: 0 | 1 | 2,
    startPoint: vec3,
    endPoint?: vec3
  ): Extent3D {
    const round = (point: vec3) => [...point].map((value) => Math.round(value));
    const start = round(startPoint);
    const end = endPoint ? round(endPoint) : [...start];

    const { size } = this.brush.getStencil();
    const center = [
      Math.floor((size[0] - 1) / 2),
      Math.floor((size[1] - 1) / 2),
    ];

    const bounds = [0, 0, 0, 0, 0, 0] as Extent3D;
    bounds[sliceAxis * 2] = start[sliceAxis];
    bounds[sliceAxis * 2 + 1] = start[sliceAxis];
    [0, 1, 2]
      .filter((axis) => axis !== sliceAxis)
      .forEach((axis, planeIndex) => {
        bounds[axis * 2] =
          Math.min(start[axis], end[axis]) - center[planeIndex];
        bounds[axis * 2 + 1] =
          Math.max(start[axis], end[axis]) +
          size[planeIndex] -
          1 -
          center[planeIndex];
      });
    return bounds;
  }

  private strokeValue() {
    const inBrushingMode =
      this.mode === PaintMode.CirclePaint || this.mode === PaintMode.Erase;
    if (this.brushValue == null || !inBrushingMode) return undefined;
    return this.mode === PaintMode.Erase ? ERASE_BRUSH_VALUE : this.brushValue;
  }

  /**
   * Adds paint to a labelmap.
   *
   * If endPoint is specified, then linearly interpolates the brush
   * from the start to the end.
   *
   * Assumption: startPoint and endPoint are on the same slice axis.
   *
   * Points are stated in whatever index space the caller walks in, and
   * `origin` says where the labelmap's own first voxel sits in it. The line
   * between two samples is walked by accumulating fractional steps and
   * rounding, so the answer depends on where the walk starts: a bounded mask
   * whose points were shifted into its own frame would round a step the other
   * way and paint a different voxel than the same stroke on another mask.
   *
   * @param labelmap paint in this labelmap
   * @param sliceAxis Which index-space axis to paint on (0, 1, or 2).
   * @param startPoint start point
   * @param endPoint ending point (optional)
   * @param origin the labelmap's first voxel, in the points' own space
   */
  paintLabelmap(
    labelmap: vtkLabelMap,
    sliceAxis: 0 | 1 | 2,
    startPoint: vec3,
    {
      endPoint,
      shouldPaint = () => true,
      onPainted,
      origin = [0, 0, 0],
    }: {
      endPoint?: vec3;
      shouldPaint?: (offset: number, point: number[]) => boolean;
      onPainted?: (point: number[]) => void;
      origin?: readonly [number, number, number];
    } = {}
  ) {
    const brushValue = this.strokeValue();
    if (brushValue === undefined) return;

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

    let changed = false;
    const labelmapPixels = labelmap.getPointData().getScalars().getData();
    const labelmapDims = labelmap.getDimensions();
    const jStride = labelmapDims[0];
    const kStride = labelmapDims[0] * labelmapDims[1];
    const [originI, originJ, originK] = origin;

    const isInBounds = (point: number[]) =>
      point[0] >= originI &&
      point[1] >= originJ &&
      point[2] >= originK &&
      point[0] < originI + labelmapDims[0] &&
      point[1] < originJ + labelmapDims[1] &&
      point[2] < originK + labelmapDims[2];

    const { pixels, size } = stencil;
    const centerX = Math.floor((size[0] - 1) / 2);
    const centerY = Math.floor((size[1] - 1) / 2);

    const point1 = [...start];
    const point2 = [...end];
    const rounded = [0, 0, 0];
    rounded[sliceAxis] = ijkSlice;
    // The two in-plane axes, in the order the line's points state them.
    const [axisU, axisV] = [0, 1, 2].filter((axis) => axis !== sliceAxis);
    const curPoint: number[] = [0, 0];

    const paintLine = () => {
      const dx = point2[0] - point1[0];
      const dy = point2[1] - point1[1];
      let steps = Math.abs(Math.abs(dx) > Math.abs(dy) ? dx : dy);
      const incX = dx / steps;
      const incY = dy / steps;
      [curPoint[0], curPoint[1]] = point1;
      while (steps-- >= 0) {
        rounded[axisU] = Math.round(curPoint[0]);
        rounded[axisV] = Math.round(curPoint[1]);

        const offset =
          rounded[0] -
          originI +
          (rounded[1] - originJ) * jStride +
          (rounded[2] - originK) * kStride;
        if (isInBounds(rounded) && shouldPaint(offset, rounded)) {
          if (labelmapPixels[offset] !== brushValue) {
            labelmapPixels[offset] = brushValue;
            changed = true;
          }
          onPainted?.(rounded);
        }

        curPoint[0] += incX;
        curPoint[1] += incY;
      }
    };
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
          paintLine();
        }
      }
    }

    if (changed) labelmap.modified();
  }
}
