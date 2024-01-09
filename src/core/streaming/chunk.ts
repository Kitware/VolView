import { UpdateEvent, enters, leaves } from '@/src/core/stateMachine';
import {
  ChunkState,
  ChunkStateMachine,
  TransitionEvent,
} from '@/src/core/streaming/chunkStateMachine';
import { DataLoader, MetaLoader } from '@/src/core/streaming/types';
import mitt, { Emitter } from 'mitt';

type ChunkEvents = {
  doneMeta: void;
  doneData: void;
  error: any;
};

interface ChunkEventData {
  error?: Error;
}

interface ChunkInit {
  metaLoader: MetaLoader;
  dataLoader: DataLoader;
}

/**
 * Represents a data chunk.
 */
export class Chunk {
  private machine: ChunkStateMachine;
  private metaLoader: MetaLoader;
  private dataLoader: DataLoader;
  private events: Emitter<ChunkEvents>;

  constructor(init: ChunkInit) {
    this.metaLoader = init.metaLoader;
    this.dataLoader = init.dataLoader;

    this.machine = new ChunkStateMachine();
    this.machine.subscribe(this.onStateUpdated);

    this.events = mitt();
  }

  dispose() {
    this.machine.unsubscribe(this.onStateUpdated);
    this.events.all.clear();
  }

  get state() {
    return this.machine.state;
  }

  get metadata() {
    return this.metaLoader.meta;
  }

  get metaBlob() {
    return this.metaLoader.metaBlob;
  }

  get dataBlob() {
    return this.dataLoader.data;
  }

  loadMeta() {
    if (this.machine.state !== ChunkState.Init) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.machine.send(TransitionEvent.LoadMeta);
      this.events.on('doneMeta', () => {
        this.cleanupEventListeners();
        resolve();
      });
      this.events.on('error', (error) => {
        this.cleanupEventListeners();
        reject(error);
      });
    });
  }

  loadData() {
    if (this.machine.state !== ChunkState.MetaOnly) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.machine.send(TransitionEvent.LoadData);
      this.events.on('doneData', () => {
        this.cleanupEventListeners();
        resolve();
      });
      this.events.on('error', (error) => {
        this.cleanupEventListeners();
        reject(error);
      });
    });
  }

  private cleanupEventListeners() {
    this.events.off('doneMeta');
    this.events.off('doneData');
    this.events.off('error');
  }

  private onStateUpdated = async (
    event: UpdateEvent<ChunkState, TransitionEvent>
  ) => {
    const data = event.data as ChunkEventData;

    if (data?.error) {
      this.events.emit('error', data.error);
    }

    if (leaves(event, ChunkState.MetaLoading)) {
      this.metaLoader.stop();
    } else if (leaves(event, ChunkState.DataLoading)) {
      this.dataLoader.stop();
    }

    if (event.event === TransitionEvent.MetaLoaded) {
      this.events.emit('doneMeta');
    } else if (event.event === TransitionEvent.DataLoaded) {
      this.events.emit('doneData');
    }

    try {
      if (enters(event, ChunkState.MetaLoading)) {
        await this.metaLoader.load();
        this.machine.send(TransitionEvent.MetaLoaded);
      } else if (enters(event, ChunkState.DataLoading)) {
        await this.dataLoader.load();
        this.machine.send(TransitionEvent.DataLoaded);
      }
    } catch (error) {
      this.machine.send(TransitionEvent.Cancel, { error });
    }
  };
}
