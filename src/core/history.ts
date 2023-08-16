import { IHistoryManager, IHistoryOperation } from '@/src/types/history';

const INFINITE_HISTORY = Infinity;

export class HistoryManager implements IHistoryManager {
  #undoStack: IHistoryOperation[];
  #redoStack: IHistoryOperation[];
  #maxHistory: number;

  constructor(maxHistory = INFINITE_HISTORY) {
    this.#maxHistory = maxHistory;
    this.#undoStack = [];
    this.#redoStack = [];
  }

  get maxHistory() {
    return this.#maxHistory;
  }

  undo() {
    if (!this.#undoStack.length) {
      return;
    }
    const op = this.#undoStack.pop()!;
    this.#redoStack.push(op);
    op.revert();
  }

  redo() {
    if (!this.#redoStack.length) {
      return;
    }
    const op = this.#redoStack.pop()!;
    this.#undoStack.push(op);
    op.apply();
  }

  pushOperation(operation: IHistoryOperation, autoApply = false) {
    this.#redoStack.length = 0;
    this.#undoStack.push(operation);
    while (this.#undoStack.length > this.#maxHistory) {
      this.#undoStack.shift();
    }
    if (autoApply && !operation.isApplied()) {
      operation.apply();
    }
  }
}
