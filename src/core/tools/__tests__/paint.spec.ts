import { describe, it, expect } from 'vitest';
import vtkLabelMap from '@/src/vtk/LabelMap';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import PaintTool from '../paint';
import EllipsePaintBrush from '../paint/ellipse-brush';

function createPaintMask() {
  const labelmap = vtkLabelMap.newInstance();
  const points = new Uint8Array(4 * 4 * 4);
  labelmap.setDimensions([4, 4, 4]);
  labelmap.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: points,
    })
  );
  return { labelmap, points };
}

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
        const { labelmap, points } = createPaintMask();
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
        const { labelmap, points } = createPaintMask();
        const brushValue = 8;
        const tool = new PaintTool();
        tool.setBrushValue(brushValue);
        tool.setBrushSize(1);
        tool.paintLabelmap(labelmap, 2, [0, 0, 0], { endPoint: [3, 3, 0] });
        for (let i = 0; i <= 3; i++) {
          const offset = i + 4 * i;
          expect(points[offset]).to.equal(brushValue);
        }
      });
      it.each([0, 1, 2] as const)(
        'claims each swept voxel once on axis %s, including rejected voxels',
        (axis) => {
          const { labelmap, points } = createPaintMask();
          const origin = [10, 20, 30] as const;
          const [u, v] = [0, 1, 2].filter((other) => other !== axis);
          const start: [number, number, number] = [...origin];
          start[axis] += 1;
          const end: [number, number, number] = [...start];
          end[u] += 3;
          end[v] += 2;
          const claimed: number[] = [];
          const tool = new PaintTool();
          tool.setBrushSize(2);
          tool.paintLabelmap(labelmap, axis, start, {
            origin,
            endPoint: end,
            shouldPaint: (offset, point) => {
              claimed.push(offset);
              return point[u] > origin[u];
            },
          });

          expect(claimed).toHaveLength(10);
          expect(new Set(claimed).size).toBe(10);
          const expected = new Uint8Array(points.length);
          [[1], [1, 2, 3], [1, 2, 3], [3]].forEach((columns, row) => {
            columns.forEach((column) => {
              const point = [0, 0, 0];
              point[axis] = 1;
              point[u] = column;
              point[v] = row;
              expected[point[0] + 4 * point[1] + 16 * point[2]] = 1;
            });
          });
          expect(points).toEqual(expected);
        }
      );
    });
  });
});
