import type { DataSource } from '@/src/io/import/dataSource';
import type { ImportHandler } from '@/src/io/import/common';
import type { RestoreProcessors } from '@/src/io/import/importDataSources';
import { restoreStateFile } from '@/src/io/import/processors/restoreStateFile';
import { Skip } from '@/src/utils/evaluateChain';

type CompletionCall = Parameters<RestoreProcessors['completeStateFileRestore']>;

/**
 * Stands in for the two restore processors so a spec can drive the pipeline
 * without a real state file: `setup` decides what the handler yields, and
 * `completion` decides whether applying it succeeds.
 */
export const recordingRestoreProcessors = (options: {
  setup: ImportHandler;
  completion?: () => Promise<void>;
}) => {
  const completions: CompletionCall[] = [];
  const processors: RestoreProcessors = {
    restoreStateFile: options.setup,
    completeStateFileRestore: async (...call: CompletionCall) => {
      completions.push(call);
      await options.completion?.();
    },
  };
  return { completions, processors };
};

/** The setup a session file yields, read but not yet applied. */
export const readSessionSetup = async (manifest: unknown) => {
  const setup = await restoreStateFile({
    type: 'file',
    file: new File([JSON.stringify(manifest)], 'session.volview.json', {
      type: 'application/json',
    }),
    fileType: 'application/json',
  });
  if (setup === Skip || setup.type !== 'stateFileSetup')
    throw new Error('Expected a session restore setup');
  return setup;
};

export const yields =
  (setup: unknown): ImportHandler =>
  () =>
    setup as ReturnType<ImportHandler>;

export const yieldsFor =
  (decide: (dataSource: DataSource) => unknown): ImportHandler =>
  (dataSource) =>
    decide(dataSource) as ReturnType<ImportHandler>;
