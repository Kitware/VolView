import { describe, it, expect } from 'vitest';
import vtkLabelMap from '@/src/vtk/LabelMap';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import PaintTool from '../paint';
import EllipsePaintBrush from '../paint/ellipse-brush';

describe('Paint Tool', () => {
  describe('EllipsePaintBrush', () => {
    it('should rasterize a ellipse', () => {
      const brush = new EllipsePaintBrush();

      brush.setSize(1);
      brush.setScale([1, 1]);
      expect(brush.getStencil()).to.deep.equal({
        pixels: new Uint8Array([1]),
        size: [1, 1],
      });

      brush.setSize(1);
      brush.setScale([3, 5]);
      expect(brush.getStencil()).to.deep.equal({
        // prettier-ignore
        pixels: new Uint8Array([
          0, 1, 0,
          1, 1, 1,
          1, 1, 1,
          1, 1, 1,
          0, 1, 0,
        ]),
        size: [3, 5],
      });

      brush.setSize(4);
      brush.setScale([1.2, 0.8]);
      expect(brush.getStencil()).to.deep.equal({
        // prettier-ignore
        pixels: new Uint8Array([
          0, 1, 1, 1, 0,
          1, 1, 1, 1, 1,
          1, 1, 1, 1, 1,
          0, 1, 1, 1, 0,
        ]),
        size: [5, 4],
      });
    });
  });

  describe('PaintTool', () => {
    describe('setBrushSize', () => {
      it('should update the widget stencil', () => {
        const tool = new PaintTool();
        tool.setBrushSize(5);
        tool.setBrushScale([1, 1]);
        const state = tool.factory.getWidgetState();
        expect(state.getStencil().size).to.deep.equal([5, 5]);
      });
    });
    describe('paintLabelmap', () => {
      it('should add paint of a given value to a labelmap', () => {
        const labelmap = vtkLabelMap.newInstance();
        const points = new Uint8Array(4 * 4 * 4);
        labelmap.setDimensions([4, 4, 4]);
        labelmap.getPointData().setScalars(
          vtkDataArray.newInstance({
            numberOfComponents: 1,
            values: points,
          })
        );
        const brushValue = 8;
        const tool = new PaintTool();
        tool.setBrushValue(brushValue);
        tool.setBrushSize(4);
        tool.paintLabelmap(labelmap, 0, [5, 5, 5]);
        expect(points.every((value) => !value)).to.be.true;
        tool.paintLabelmap(labelmap, 0, [1, 1, 1]);
        // only checks some of the brush, not the entire brush.
        expect(points[1 + 4 * 1 + 16 * 1]).to.equal(brushValue);
      });
      it('should linearly interpolate points', () => {
        const labelmap = vtkLabelMap.newInstance();
        const points = new Uint8Array(4 * 4 * 4);
        labelmap.setDimensions([4, 4, 4]);
        labelmap.getPointData().setScalars(
          vtkDataArray.newInstance({
            numberOfComponents: 1,
            values: points,
          })
        );
        const brushValue = 8;
        const tool = new PaintTool();
        tool.setBrushValue(brushValue);
        tool.setBrushSize(1);
        tool.paintLabelmap(labelmap, 2, [0, 0, 0], [3, 3, 0]);
        for (let i = 0; i <= 3; i++) {
          const offset = i + 4 * i;
          expect(points[offset]).to.equal(brushValue);
        }
      });
    });
  });
});
