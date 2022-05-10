import vtkPaintWidget from '@/src/vtk/PaintWidget';

export default class PaintToolManager {
  readonly factory: vtkPaintWidget;

  constructor() {
    this.factory = vtkPaintWidget.newInstance();
  }
}
