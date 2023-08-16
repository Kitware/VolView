import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { Maybe } from '@/src/types';
import { AnnotationTool } from '@/src/types/annotation-tool';
import { IHistoryOperation } from '@/src/types/history';
import { Store } from 'pinia';

export function createAddToolOperation<
  ID extends string,
  T extends AnnotationTool<ID>,
  S extends AnnotationToolStore<ID> & Store
>(store: S, initToolState: Partial<T>): IHistoryOperation<ID> {
  let id: Maybe<ID> = null;
  let toolState: Maybe<T> = null;

  const isApplied = () => id != null;

  const apply = () => {
    if (isApplied()) return id!;
    id = store.addTool(toolState ?? initToolState);
    return id;
  };

  const revert = () => {
    if (!isApplied()) return;
    toolState = store.toolByID[id!] as T;
    store.removeTool(id!);
    id = null;
  };

  return {
    apply,
    revert,
    isApplied,
  };
}

export function createRemoveToolOperation<
  ID extends string,
  S extends AnnotationToolStore<ID> & Store
>(store: S, id: ID): IHistoryOperation {
  let tool: Maybe<AnnotationTool<ID>> = null;

  const isApplied = () => tool != null;

  const apply = () => {
    if (isApplied()) return;
    tool = store.toolByID[id];
    store.removeTool(id);
  };

  const revert = () => {
    if (!isApplied()) return;
    store.addTool(tool!);
    tool = null;
  };

  return {
    apply,
    revert,
    isApplied,
  };
}

export function createUpdateToolOperation<
  ID extends string,
  T extends AnnotationTool<ID>,
  S extends AnnotationToolStore<ID> & Store
>(store: S, id: ID, toolPatch: Partial<T>): IHistoryOperation {
  // cannot use structuredClone() b/c of vue proxies
  const originalTool: AnnotationTool<ID> = JSON.parse(
    JSON.stringify(store.toolByID[id])
  );
  let applied = false;

  const isApplied = () => applied;

  const apply = () => {
    if (isApplied()) return;
    store.updateTool(id, toolPatch);
    applied = true;
  };

  const revert = () => {
    if (!isApplied()) return;
    store.updateTool(id, originalTool);
    applied = false;
  };

  return {
    apply,
    revert,
    isApplied,
  };
}
