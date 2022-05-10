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
  });
});
