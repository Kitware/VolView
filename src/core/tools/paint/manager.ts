import vtkPaintWidget from '@/src/vtk/PaintWidget';
import { IPaintBrush } from './brush';
import CirclePaintBrush from './circle-brush';

export default class PaintToolManager {
  readonly factory: vtkPaintWidget;
  private brush: IPaintBrush;

  constructor() {
    this.factory = vtkPaintWidget.newInstance();
    this.brush = new CirclePaintBrush();
  }

  setBrushSize(size: number) {
    this.brush.setSize(size);
    const stamp = this.brush.getStamp();
    const widgetState = this.factory.getWidgetState();
    widgetState.setStamp(stamp.pixels);
    widgetState.setStampSize(stamp.size);
  }
}
