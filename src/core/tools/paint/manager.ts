import vtkLabelMap from '@/src/vtk/LabelMap';
import vtkPaintWidget from '@/src/vtk/PaintWidget';
import { vec3 } from 'gl-matrix';
import { IPaintBrush, IBrushStamp } from './brush';
import CirclePaintBrush from './circle-brush';

function normalizeScale(scale: number[]) {
  const min = Math.min(...scale);
  return scale.map((val) => val / min);
}

/**
 * Rescales a 2D stamp.
 *
 * Scaling is done relative to the center of the stamp.
 * If inverse is supplied, then "undos" the scaling.
 *
 * @param stamp the stamp to rescale
 * @param scale an X/Y scale
 * @param inverse should the scale operation be inverted
 */
export function rescaleStamp(
  stamp: IBrushStamp,
  scale: number[],
  inverse: boolean = false
): IBrushStamp {
  const adjustedScale = normalizeScale(
    inverse ? scale.map((v) => 1 / v) : scale
  );
  const newSizeX = Math.ceil(stamp.size[0] * adjustedScale[0]);
  const newSizeY = Math.ceil(stamp.size[1] * adjustedScale[1]);

  const pixels = new Uint8Array(newSizeX * newSizeY);

  for (let y = 0; y < newSizeY; y++) {
    const srcY = Math.floor(y / adjustedScale[1]);
    const dstYOffset = y * newSizeX;
    const srcYOffset = srcY * stamp.size[0];
    for (let x = 0; x < newSizeX; x++) {
      const srcX = Math.floor(x / adjustedScale[0]);
      const dstOffset = dstYOffset + x;
      const srcOffset = srcYOffset + srcX;
      pixels[dstOffset] = stamp.pixels[srcOffset];
    }
  }

  return {
    pixels,
    size: [newSizeX, newSizeY],
  };
}

export default class PaintToolManager {
  readonly factory: vtkPaintWidget;
  private brush: IPaintBrush;
  private brushValue: number;

  constructor() {
    this.factory = vtkPaintWidget.newInstance();
    this.brush = new CirclePaintBrush();
    this.brushValue = 1;
  }

  setBrushSize(size: number) {
    this.brush.setSize(size);
    const stamp = this.brush.getStamp();
    const widgetState = this.factory.getWidgetState();
    widgetState.setStamp(stamp.pixels);
    widgetState.setStampSize(stamp.size);
  }

  setBrushValue(value: number) {
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
    const scale = [...labelmap.getSpacing()];
    scale.splice(sliceAxis, 1);
    const stamp = rescaleStamp(this.brush.getStamp(), scale, true);

    const start = [...startPoint.map((val) => Math.floor(val))];
    // Assumption: startPoint and endPoint are on the same slice axis.
    const ijkSlice = start[sliceAxis];
    start.splice(sliceAxis, 1);

    let end = [...start];
    if (endPoint) {
      end = [...endPoint.map((val) => Math.floor(val))];
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

    const { pixels, size } = stamp;
    const centerX = Math.floor((size[0] - 1) / 2);
    const centerY = Math.floor((size[1] - 1) / 2);

    const point1 = [...start];
    const point2 = [...end];
    const rounded = [0, 0, 0];
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

          const curPoint: number[] = [0, 0];

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
              labelmapPixels[offset] = this.brushValue;
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
