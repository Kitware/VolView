import StateMachine from '@/src/core/stateMachine';

export enum ChunkState {
  Init = 'Init',
  MetaLoading = 'MetaLoading',
  MetaOnly = 'MetaOnly',
  DataLoading = 'DataLoading',
  Loaded = 'Loaded',
}

export enum TransitionEvent {
  LoadMeta = 'LoadMeta',
  MetaLoaded = 'MetaLoaded',
  LoadData = 'LoadData',
  DataLoaded = 'DataLoaded',
  Cancel = 'Cancel',
}

export class ChunkStateMachine extends StateMachine<
  ChunkState,
  TransitionEvent
> {
  constructor() {
    super(ChunkState.Init, {
      [ChunkState.Init]: {
        [TransitionEvent.LoadMeta]: ChunkState.MetaLoading,
      },
      [ChunkState.MetaLoading]: {
        [TransitionEvent.Cancel]: ChunkState.Init,
        [TransitionEvent.MetaLoaded]: ChunkState.MetaOnly,
      },
      [ChunkState.MetaOnly]: {
        [TransitionEvent.LoadData]: ChunkState.DataLoading,
      },
      [ChunkState.DataLoading]: {
        [TransitionEvent.DataLoaded]: ChunkState.Loaded,
        [TransitionEvent.Cancel]: ChunkState.MetaOnly,
      },
    });
  }
}
