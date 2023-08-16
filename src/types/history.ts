export interface IHistoryOperation<T = void> {
  apply(): T;
  revert(): void;
  isApplied(): boolean;
}

export interface IHistoryManager {
  undo(): void;
  redo(): void;
  pushOperation(operation: IHistoryOperation): void;
}
