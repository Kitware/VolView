import vtkLabelMap from '@/src/vtk/LabelMap';
import vtkPaintWidget from '@/src/vtk/PaintWidget';
import { vec3 } from 'gl-matrix';
import { IPaintBrush } from './brush';
import CirclePaintBrush from './circle-brush';

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    endPoint?: vec3
  ) {
    const stamp = this.brush.getStamp();
    const start = [...startPoint.map((val) => Math.floor(val))];
    // Assumption: startPoint and endPoint are on the same slice axis.
    const ijkSlice = start[sliceAxis];
    start.splice(sliceAxis, 1);

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

    const curPoint = [...start];
    for (let y = 0; y < size[0]; y++) {
      const ydelta = y - centerY;
      const yoffset = y * size[0];
      for (let x = 0; x < size[1]; x++) {
        const xdelta = x - centerX;
        const pixelOffset = yoffset + x;
        if (pixels[pixelOffset]) {
          curPoint[0] = start[0] + xdelta;
          curPoint[1] = start[1] + ydelta;

          // add slice axis to make a proper 3D index
          curPoint.splice(sliceAxis, 0, ijkSlice);

          if (isInBounds(curPoint)) {
            const curPointIndex =
              curPoint[0] + curPoint[1] * jStride + curPoint[2] * kStride;
            labelmapPixels[curPointIndex] = this.brushValue;
          }

          // undo adding the slice axis value
          curPoint.splice(sliceAxis, 1);
        }
      }
    }

    labelmap.getPointData().getScalars().modified();
    labelmap.modified();
  }
}
