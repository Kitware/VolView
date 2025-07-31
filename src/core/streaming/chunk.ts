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
  private userData: Map<string, unknown>;

  constructor(init: ChunkInit) {
    this.metaLoader = init.metaLoader;
    this.dataLoader = init.dataLoader;
    this.userData = new Map();

    this.machine = new ChunkStateMachine();
    this.machine.subscribe(this.onStateUpdated);

    this.events = mitt();
  }

  getUserData(key: string) {
    return this.userData.get(key);
  }

  setUserData(key: string, value: unknown) {
    return this.userData.set(key, value);
  }

  addEventListener(event: keyof ChunkEvents, callback: (arg?: any) => void) {
    this.events.on(event, callback);
    return () => this.removeEventListener(event, callback);
  }

  removeEventListener(event: keyof ChunkEvents, callback: (arg?: any) => void) {
    this.events.off(event, callback);
  }

  watchForState(state: ChunkState, callback: () => void) {
    const handler = (event: UpdateEvent<ChunkState, TransitionEvent>) => {
      if (state === event.state) callback();
    };

    return this.machine.subscribe(handler);
  }

  dispose() {
    this.machine.unsubscribe(this.onStateUpdated);
    this.events.all.clear();
    this.userData.clear();
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
      const onDoneMeta = () => {
        this.events.off('doneMeta', onDoneMeta);
        resolve();
      };
      const onError = (error: any) => {
        this.events.off('error', onError);
        reject(error);
      };
      this.events.on('doneMeta', onDoneMeta);
      this.events.on('error', onError);
    });
  }

  stopLoad() {
    this.machine.send(TransitionEvent.Cancel);
  }

  loadData() {
    if (this.machine.state !== ChunkState.MetaOnly) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.machine.send(TransitionEvent.LoadData);
      const onDoneData = () => {
        this.events.off('doneData', onDoneData);
        resolve();
      };
      const onError = (error: any) => {
        this.events.off('error', onError);
        reject(error);
      };
      this.events.on('doneData', onDoneData);
      this.events.on('error', onError);
    });
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

export function waitForChunkState(chunk: Chunk, state: ChunkState) {
  return new Promise<Chunk>((resolve) => {
    if (chunk.state === state) {
      resolve(chunk);
      return;
    }

    const stop = chunk.watchForState(state, () => {
      resolve(chunk);
      stop();
    });
  });
}
