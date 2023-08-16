import { HistoryManager } from '@/src/core/history';
import { IHistoryOperation } from '@/src/types/history';
import { defineStore } from 'pinia';

export interface HistoryContextKeyComponents {
  datasetID: string;
}

export function createHistoryContextKey<
  C extends {} = HistoryContextKeyComponents
>(components: C) {
  return Object.entries(components)
    .reduce(
      (flattened, [key, value]) => [...flattened, `${key}:${value}`],
      [] as string[]
    )
    .join(',');
}

const useHistoryStore = defineStore('history', () => {
  const managers: Record<string, HistoryManager> = Object.create(null);

  const pushOperation = (
    key: HistoryContextKeyComponents,
    operation: IHistoryOperation,
    autoApply = false
  ) => {
    const contextKey = createHistoryContextKey(key);
    if (!(contextKey in managers)) {
      managers[contextKey] = new HistoryManager();
    }
    managers[contextKey].pushOperation(operation, autoApply);
  };

  const getManager = (key: HistoryContextKeyComponents) => {
    const contextKey = createHistoryContextKey(key);
    return managers[contextKey];
  };

  const undo = (key: HistoryContextKeyComponents) => {
    getManager(key)?.undo();
  };

  const redo = (key: HistoryContextKeyComponents) => {
    getManager(key)?.redo();
  };

  return {
    pushOperation,
    undo,
    redo,
  };
});

export default useHistoryStore;
