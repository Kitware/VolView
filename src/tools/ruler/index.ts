import { Vector3 } from '@kitware/vtk.js/types';
import { ImageMetadata } from '@/src/storex/datasets-images';
import { LPSAxis } from '@/src/utils/lps';
import {
  InteractionState,
  RulerWidgetState,
} from '@/src/vtk/RulerWidget/state';
import vtkRulerWidget from '@/src/vtk/RulerWidget';
import mitt, { Emitter } from 'mitt';

export interface SerializedRulerV1 {
  version: '1.0';
  /**
   * Index space
   */
  firstPoint: Vector3;
  /**
   * Index space
   */
  secondPoint: Vector3;
  viewAxis: LPSAxis;
  /**
   * Index space slice
   */
  slice: number;
  imageID: string;
  /**
   * imageMetadata is saved as context for where
   * the measurement is located in the world.
   */
  imageMetadata: Omit<ImageMetadata, 'name'>;
}

export interface RulerStateUpdate {
  firstPoint?: Vector3 | null;
  secondPoint?: Vector3 | null;
  interactionState?: InteractionState;
}

export type RulerToolManagerEvents = {
  widgetUpdate: {
    id: string;
    update: RulerStateUpdate;
  };
};

export default class RulerToolManager {
  private listeners: Map<string, Function>;
  private factories: Map<string, vtkRulerWidget>;
  public events: Emitter<RulerToolManagerEvents>;

  constructor() {
    this.listeners = new Map();
    this.factories = new Map();
    this.events = mitt();
  }

  getFactory(id: string) {
    return this.factories.get(id) ?? null;
  }

  createRuler(id: string) {
    if (this.factories.has(id)) {
      return this.factories.get(id);
    }
    const factory = vtkRulerWidget.newInstance();
    this.listeners.set(
      id,
      this.createStoreUpdater(id, factory.getWidgetState())
    );

    /*
    if (initialState) {
      const state = factory.getWidgetState();
      const firstPoint = [...initialState.firstPoint] as Vector3;
      const secondPoint = [...initialState.secondPoint] as Vector3;

      const { indexToWorld } = initialState.imageMetadata;
      vec3.transformMat4(firstPoint, firstPoint, indexToWorld);
      vec3.transformMat4(secondPoint, firstPoint, indexToWorld);

      state.getFirstPoint().setOrigin(firstPoint);
      state.getFirstPoint().setOrigin(secondPoint);
      state.setInteractionState(InteractionState.Settled);
    }
    */

    this.factories.set(id, factory);
    return factory;
  }

  removeRuler(id: string) {
    this.factories.delete(id);
    const cleanup = this.listeners.get(id);
    if (cleanup) {
      cleanup();
      this.listeners.delete(id);
    }
  }

  createStoreUpdater(id: string, state: RulerWidgetState) {
    const sub = state.onModified(() => {
      // because we don't actually know what changed, we fill the update state
      // with the two points
      const update: RulerStateUpdate = {
        firstPoint: state.getFirstPoint().getOrigin(),
        secondPoint: state.getSecondPoint().getOrigin(),
      };

      this.events.emit('widgetUpdate', { id, update });
    });

    return () => {
      sub.unsubscribe();
    };
  }

  updateRuler(id: string, update: RulerStateUpdate) {
    const factory = this.factories.get(id);
    if (factory) {
      const state = factory.getWidgetState();
      const first = state.getFirstPoint();
      const second = state.getSecondPoint();

      if (update.firstPoint) {
        first.setOrigin(update.firstPoint);
        first.setVisible(true);
      }
      if (update.secondPoint) {
        second.setOrigin(update.secondPoint);
        second.setVisible(true);
      }
      if (update.interactionState) {
        state.setInteractionState(update.interactionState);
      }
      console.log(update, state.getInteractionState());
    }
  }

  setFirstPoint(id: string, point: Vector3) {
    const factory = this.factories.get(id);
    if (factory) {
      const state = factory.getWidgetState();
      state.getFirstPoint().setOrigin(point);
    }
  }

  setSecondPoint(id: string, point: Vector3) {
    const factory = this.factories.get(id);
    if (factory) {
      const state = factory.getWidgetState();
      state.getSecondPoint().setOrigin(point);
    }
  }
}
