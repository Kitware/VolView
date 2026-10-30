import { UpdateEvent, enters, leaves } from './stateMachine';
import {
  ChunkState,
  ChunkStateMachine,
  TransitionEvent,
} from './chunkStateMachine';
import { DataLoader, MetaLoader } from './types';
import mitt, { Emitter } from 'mitt';

type ChunkEvents = { doneMeta: void; doneData: void; error: unknown };
type ChunkInit = {
  metaLoader: MetaLoader;
  dataLoader: DataLoader;
  onDispose?: () => void;
};
const cancelled = () =>
  new DOMException('DICOM loading cancelled', 'AbortError');

/** A source instance owns its bytes until disposal; its immutable metadata remains inspectable afterwards. */
export class Chunk {
  private machine = new ChunkStateMachine();
  private metaLoader: MetaLoader;
  private dataLoader: DataLoader;
  private events: Emitter<ChunkEvents> = mitt();
  private userData = new Map<string, unknown>();
  private generation = 0;
  private disposed = false;
  private onDispose?: () => void;
  private pendingMeta: Promise<void> | null = null;
  private pendingData: Promise<void> | null = null;

  constructor(init: ChunkInit) {
    this.metaLoader = init.metaLoader;
    this.dataLoader = init.dataLoader;
    this.onDispose = init.onDispose;
    this.machine.subscribe(this.onStateUpdated);
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
    return this.machine.subscribe((event) => {
      if (state === event.state) callback();
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoad();
    this.machine.unsubscribe(this.onStateUpdated);
    this.events.all.clear();
    this.userData.clear();
    this.metaLoader.dispose?.();
    this.dataLoader.dispose?.();
    this.onDispose?.();
    this.onDispose = undefined;
  }

  get state() {
    return this.machine.state;
  }

  get metadata() {
    return this.metaLoader.meta;
  }

  get fileLayout() {
    return this.metaLoader.fileLayout;
  }

  get ultrasoundRegions() {
    return this.metaLoader.ultrasoundRegions;
  }

  get dataBlob() {
    return this.dataLoader.data;
  }

  loadMeta() {
    if (this.disposed) return Promise.reject(cancelled());
    if (this.pendingMeta) return this.pendingMeta;
    if (this.state !== ChunkState.Init) return Promise.resolve();
    const pending = this.load('doneMeta', TransitionEvent.LoadMeta).finally(
      () => {
        if (this.pendingMeta === pending) this.pendingMeta = null;
      }
    );
    this.pendingMeta = pending;
    return pending;
  }

  stopLoad() {
    this.generation += 1;
    this.machine.send(TransitionEvent.Cancel, { error: cancelled() });
    this.pendingMeta = null;
    this.pendingData = null;
  }

  loadData() {
    if (this.disposed) return Promise.reject(cancelled());
    if (this.pendingData) return this.pendingData;
    if (this.state !== ChunkState.MetaOnly) return Promise.resolve();
    const pending = this.load('doneData', TransitionEvent.LoadData).finally(
      () => {
        if (this.pendingData === pending) this.pendingData = null;
      }
    );
    this.pendingData = pending;
    return pending;
  }

  private load(done: 'doneMeta' | 'doneData', transition: TransitionEvent) {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.events.off(done, onDone);
        this.events.off('error', onError);
      };
      const onDone = () => {
        cleanup();
        resolve();
      };
      const onError = (error: unknown) => {
        cleanup();
        reject(error);
      };
      this.events.on(done, onDone);
      this.events.on('error', onError);
      this.machine.send(transition);
    });
  }

  private onStateUpdated = async (
    event: UpdateEvent<ChunkState, TransitionEvent>
  ) => {
    const generation = this.generation;
    const complete = (transition: TransitionEvent, data?: unknown) => {
      if (generation === this.generation && !this.disposed)
        this.machine.send(transition, data);
    };
    if (leaves(event, ChunkState.MetaLoading)) this.metaLoader.stop();
    else if (leaves(event, ChunkState.DataLoading)) this.dataLoader.stop();
    if (event.data?.error) this.events.emit('error', event.data.error);
    if (event.event === TransitionEvent.MetaLoaded)
      this.events.emit('doneMeta');
    else if (event.event === TransitionEvent.DataLoaded)
      this.events.emit('doneData');
    try {
      if (enters(event, ChunkState.MetaLoading)) {
        await this.metaLoader.load();
        complete(TransitionEvent.MetaLoaded);
      } else if (enters(event, ChunkState.DataLoading)) {
        await this.dataLoader.load();
        complete(TransitionEvent.DataLoaded);
      }
    } catch (error) {
      complete(TransitionEvent.Cancel, { error });
    }
  };
}

export function waitForChunkState(chunk: Chunk, state: ChunkState) {
  return new Promise<Chunk>((resolve, reject) => {
    if (chunk.state === state) {
      resolve(chunk);
      return;
    }
    const stop = chunk.watchForState(state, () => {
      stop();
      stopError();
      resolve(chunk);
    });
    const stopError = chunk.addEventListener('error', (error) => {
      stop();
      stopError();
      reject(error);
    });
  });
}
