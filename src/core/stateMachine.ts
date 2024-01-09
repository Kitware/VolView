import mitt, { Emitter } from 'mitt';

/**
 * The payload of an update event.
 */
export type UpdateEvent<S, TE> = {
  state: S;
  prevState: S;
  event: TE;
  data?: any;
};

/**
 * The available events emitted internally by a state machine.
 */
export type StateMachineEvents<S, TE> = {
  update: UpdateEvent<S, TE>;
};

/**
 * The available state transitions.
 */
export type StateTransitions<S extends string, TE extends string> = Partial<
  Record<S, Partial<Record<TE, S>>>
>;

/**
 * Tests to see if a state event is entering a given state.
 * @param event
 * @param state
 * @returns
 */
export function enters<S, TE>(event: UpdateEvent<S, TE>, state: S) {
  return event.state === state;
}

/**
 * Tests to see if a state event is leaving a given state.
 * @param event
 * @param state
 * @returns
 */
export function leaves<S, TE>(event: UpdateEvent<S, TE>, state: S) {
  return event.prevState === state;
}

/**
 * Represents a state machine.
 */
export default class StateMachine<
  S extends string,
  TE extends string,
  E extends StateMachineEvents<S, TE> = StateMachineEvents<S, TE>
> {
  private _events: Emitter<E>;
  private _state: S;
  private _transitions: StateTransitions<S, TE>;

  constructor(initState: S, transitions: StateTransitions<S, TE>) {
    this._state = initState;
    this._transitions = transitions;
    this._events = mitt();
  }

  get state() {
    return this._state;
  }

  /**
   * Send an event to the state machine to trigger a transition.
   *
   * Event data will be broadcasted to update subscribers.
   * @param event
   * @param eventData
   * @returns
   */
  send(event: TE, eventData?: any) {
    if (!(this._state in this._transitions)) return;
    const stateTransitions = this._transitions[this._state]!;

    if (!(event in stateTransitions)) return;
    const prevState = this._state;
    this._state = stateTransitions[event]!;
    this._events.emit('update', {
      state: this._state,
      prevState,
      event,
      data: eventData,
    });
  }

  /**
   * Subscribe to the update event.
   *
   * Returns a function to unsubscribe.
   * @param callback
   * @returns
   */
  subscribe(callback: (event: UpdateEvent<S, TE>) => void) {
    this._events.on('update', callback);
    return () => {
      this.unsubscribe(callback);
    };
  }

  /**
   * Unsubscribe from the update event.
   * @param callback
   */
  unsubscribe(callback: (event: UpdateEvent<S, TE>) => void) {
    this._events.off('update', callback);
  }
}
