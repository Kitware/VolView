import { InteractionState } from '@/src/vtk/RulerWidget/state';
import { Vector3 } from '@kitware/vtk.js/types';
import { expect } from 'chai';
import RulerToolManager, { RulerStateUpdate } from '../ruler';

type EventData = {
  id: string;
  update: RulerStateUpdate;
};

describe('Ruler Tool Manager', () => {
  describe('createRuler', () => {
    it('should create a ruler', () => {
      const manager = new RulerToolManager();
      const factory = manager.createRuler('1');
      expect(factory!.getClassName()).to.equal('vtkRulerWidget');

      manager.teardown();
    });
    it('should register an event emitter for when state is updated', async () => {
      const manager = new RulerToolManager();
      const factory = manager.createRuler('1');
      const state = factory.getWidgetState();

      const promise = new Promise<EventData>((resolve) => {
        manager.events.on('widgetUpdate', (eventData) => {
          resolve(eventData);
        });
      });

      state.getFirstPoint().setOrigin([10, 20, 10]);
      const eventData = await promise;

      expect(eventData.id).to.equal('1');
      expect(eventData.update.firstPoint).to.deep.equal([10, 20, 10]);

      manager.teardown();
    });
  });

  describe('updateRuler', () => {
    it('should update the internal widget state', () => {
      const manager = new RulerToolManager();
      const factory = manager.createRuler('1');
      const state = factory.getWidgetState();

      const firstPoint = [12, 13, 14] as Vector3;
      const secondPoint = [15, 16, 17] as Vector3;

      manager.updateRuler('1', {
        firstPoint,
        secondPoint,
        interactionState: InteractionState.Settled,
      });

      expect(state.getFirstPoint().getOrigin()).to.deep.equal(firstPoint);
      expect(state.getFirstPoint().getVisible()).to.be.true;
      expect(state.getSecondPoint().getOrigin()).to.deep.equal(secondPoint);
      expect(state.getSecondPoint().getVisible()).to.be.true;
      expect(state.getInteractionState()).to.equal(InteractionState.Settled);
    });
  });

  describe('removeRuler', () => {
    it('should delete a ruler', () => {
      const manager = new RulerToolManager();
      manager.createRuler('1');
      manager.removeRuler('1');

      expect(manager.getFactory('1')).to.be.null;
    });
  });
});
