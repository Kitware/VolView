import { ref, shallowRef, watch, unref, type MaybeRef } from 'vue';
import type { ProjectionInput, ProjectionResult } from './types';

const createProjectionWorker = () =>
  new Worker(new URL('./projection.worker.ts', import.meta.url), {
    type: 'module',
  });

export function useEnFaceProjection(
  request: MaybeRef<ProjectionInput | null>,
  createWorker = createProjectionWorker
) {
  const accepted = shallowRef<{
    request: ProjectionInput;
    result: ProjectionResult;
  } | null>(null);
  const computing = ref(false);
  const error = ref<string | null>(null);
  watch(
    () => unref(request),
    (incoming, _previous, onCleanup) => {
      let active = true;
      let worker: Worker | undefined;
      const finish = () => {
        active = false;
        if (worker) {
          worker.onmessage = null;
          worker.onerror = null;
          worker.onmessageerror = null;
          worker.terminate();
        }
      };
      onCleanup(finish);
      accepted.value = null;
      error.value = null;
      computing.value = !!incoming;
      if (!incoming) return;
      const fail = (message: string) => {
        if (!active) return;
        error.value = message;
        computing.value = false;
        finish();
      };
      try {
        worker = createWorker();
        worker.onmessage = (event: MessageEvent<ProjectionResult>) => {
          if (!active) return;
          accepted.value = { request: incoming, result: event.data };
          computing.value = false;
          finish();
        };
        worker.onerror = (event) =>
          fail(event.message || 'The OCT projection worker failed.');
        worker.onmessageerror = () => fail('The OCT projection worker failed.');
        // Structured cloning keeps source and segmentation buffers owned by their views.
        worker.postMessage(incoming);
      } catch (cause) {
        fail(
          cause instanceof Error ? cause.message : 'En face projection failed.'
        );
      }
    },
    { immediate: true, flush: 'sync' }
  );
  return { accepted, computing, error };
}
