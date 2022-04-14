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

type RulerToolManagerEvents = {
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

  teardown() {
    this.events.all.clear();
    this.listeners.forEach((stop) => stop());
    this.factories.forEach((factory) => factory.delete());
    this.listeners.clear();
    this.factories.clear();
  }

  getFactory(id: string) {
    return this.factories.get(id) ?? null;
  }

  createRuler(id: string): vtkRulerWidget {
    if (this.factories.has(id)) {
      return this.factories.get(id)!;
    }
    const factory = vtkRulerWidget.newInstance();
    this.listeners.set(
      id,
      this.createStoreUpdater(id, factory.getWidgetState())
    );

    this.factories.set(id, factory);
    return factory;
  }

  removeRuler(id: string) {
    const factory = this.factories.get(id);
    if (factory) {
      factory.delete();
      this.factories.delete(id);
    }
    const cleanup = this.listeners.get(id);
    if (cleanup) {
      cleanup();
      this.listeners.delete(id);
    }
  }

  private createStoreUpdater(id: string, state: RulerWidgetState) {
    const sub = state.onModified(() => {
      const update: RulerStateUpdate = {
        firstPoint: state.getFirstPoint().getOrigin(),
        secondPoint: state.getSecondPoint().getOrigin(),
        interactionState: state.getInteractionState(),
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
      if (Number.isInteger(update.interactionState)) {
        state.setInteractionState(update.interactionState!);
      }
    }
  }
}
