import { AnnotationToolAPI } from '@/src/store/tools/useAnnotationTool';
import { AnnotationTool } from '@/src/types/annotation-tool';
import { defineStore } from 'pinia';

/**
 * Type helper for enforcing the typing for annotation tool stores.
 *
 * Requires setup store usage rather than template usage.
 * @param name
 * @param setup
 * @returns
 */
export function defineAnnotationToolStore<
  T extends AnnotationTool,
  S extends AnnotationToolAPI<T>
>(name: string, setup: () => S) {
  return defineStore(name, setup);
}
