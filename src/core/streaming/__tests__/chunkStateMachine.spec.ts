import {
  ChunkState,
  ChunkStateMachine,
  TransitionEvent,
} from '@/src/core/streaming/chunkStateMachine';
import { describe, expect, it } from 'vitest';

describe('chunk', () => {
  describe('state machine', () => {
    it('should transition properly', () => {
      const machine = new ChunkStateMachine();

      expect(machine.state).to.equal(ChunkState.Init);

      [
        TransitionEvent.LoadData,
        TransitionEvent.MetaLoaded,
        TransitionEvent.DataLoaded,
        TransitionEvent.Cancel,
      ].forEach((event) => {
        machine.send(event);
        expect(machine.state).to.equal(ChunkState.Init);
      });

      machine.send(TransitionEvent.LoadMeta);
      expect(machine.state).to.equal(ChunkState.MetaLoading);

      machine.send(TransitionEvent.MetaLoaded);
      expect(machine.state).to.equal(ChunkState.MetaOnly);

      machine.send(TransitionEvent.LoadData);
      expect(machine.state).to.equal(ChunkState.DataLoading);

      machine.send(TransitionEvent.DataLoaded);
      expect(machine.state).to.equal(ChunkState.Loaded);
    });
  });
});
