import vtkLabelMap from '@/src/vtk/LabelMap';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { expect } from 'chai';
import { PaintToolManager } from '../paint';
import CirclePaintBrush from '../paint/circle-brush';

describe('Paint Tool', () => {
  describe('CirclePaintBrush', () => {
    it('should rasterize a circle of a given radius', () => {
      const brush = new CirclePaintBrush();

      brush.setSize(1);
      expect(brush.getStamp()).to.deep.equal({
        pixels: new Uint8Array([1]),
        size: [1, 1],
      });

      brush.setSize(2);
      expect(brush.getStamp()).to.deep.equal({
        // prettier-ignore
        pixels: new Uint8Array([
            1, 1, 1,
            1, 1, 1,
            1, 1, 1,
        ]),
        size: [3, 3],
      });

      brush.setSize(3);
      expect(brush.getStamp()).to.deep.equal({
        // prettier-ignore
        pixels: new Uint8Array([
            0, 1, 1, 1, 0,
            1, 1, 1, 1, 1,
            1, 1, 1, 1, 1,
            1, 1, 1, 1, 1,
            0, 1, 1, 1, 0,
        ]),
        size: [5, 5],
      });
    });
  });

  describe('PaintToolManager', () => {
    describe('setBrushSize', () => {
      it('should set the widget stamp', () => {
        const manager = new PaintToolManager();
        manager.setBrushSize(5);
        const state = manager.factory.getWidgetState();
        expect(state.getStamp()).to.not.be.null;
        expect(state.getStampSize()).to.not.deep.equal([0, 0]);
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
        const manager = new PaintToolManager();
        manager.setBrushValue(brushValue);
        manager.setBrushSize(2);

        manager.paintLabelmap(labelmap, 0, [5, 5, 5]);
        expect(points.every((value) => !value)).to.be.true;
        manager.paintLabelmap(labelmap, 0, [2, 2, 2]);
        // only checks some of the brush, not the entire brush.
        expect(points[2 + 4 * 2 + 16 * 2]).to.equal(brushValue);
        expect(points[2 + 4 * 3 + 16 * 3]).to.equal(brushValue);
        expect(points[2 + 4 * 1 + 16 * 1]).to.equal(brushValue);
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
        const manager = new PaintToolManager();
        manager.setBrushValue(brushValue);
        manager.setBrushSize(1);

        manager.paintLabelmap(labelmap, 2, [0, 0, 0], [3, 3, 0]);
        for (let i = 0; i <= 3; i++) {
          const offset = i + 4 * i;
          expect(points[offset]).to.equal(brushValue);
        }
      });

      it('should rescale the brush into image space', () => {
        const labelmap = vtkLabelMap.newInstance();
        const points = new Uint8Array(4 * 4 * 4);
        labelmap.setDimensions([4, 4, 4]);
        labelmap.setSpacing([2, 2, 1]);
        labelmap.getPointData().setScalars(
          vtkDataArray.newInstance({
            numberOfComponents: 1,
            values: points,
          })
        );

        const brushValue = 8;
        const manager = new PaintToolManager();
        manager.setBrushValue(brushValue);
        manager.setBrushSize(3);

        manager.paintLabelmap(labelmap, 2, [1, 1, 1]);
        expect(Array.from(points.slice(4 * 4, 7 * 4 + 3))).to.deep.equal(
          Array(15).fill(brushValue)
        );
      });
    });
  });
});
