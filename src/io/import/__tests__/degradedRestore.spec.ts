import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { importDataSources } from '@/src/io/import/importDataSources';
import { useMessageStore, MessageType } from '@/src/store/messages';
import {
  recordingRestoreProcessors,
  yields,
} from '@/src/io/import/__tests__/restoreProcessorFixtures';

// ---------------------------------------------------------------------------
// Auto-degrade-to-ephemeral: a scene
// whose restore application throws mid-way degrades to an ephemeral open —
// already-loaded bases stay as plain datasets, ONE notice fires, and the
// import NEVER becomes an error loop or a rejected promise.
// ---------------------------------------------------------------------------

const aSetup = yields({
  type: 'stateFileSetup',
  dataSources: [],
  manifest: { version: '6.4.0', dataSources: [] },
  stateFiles: [],
  missingFiles: [],
});

const sessionFile = () =>
  new File(['{}'], 'session.volview.json', { type: 'application/json' });

describe('importDataSources — degraded restore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('a mid-restore throw degrades to an ephemeral open with ONE notice', async () => {
    const restore = recordingRestoreProcessors({
      setup: aSetup,
      completion: async () => {
        throw new Error('segment group deserialize exploded');
      },
    });

    const results = await importDataSources(
      [{ type: 'file', file: sessionFile(), fileType: 'application/json' }],
      restore.processors
    );

    expect(results.filter((result) => result.type === 'error')).toEqual([]);

    const { messages } = useMessageStore();
    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe(MessageType.Warning);
    expect(messages[0].options.details).toContain(
      'segment group deserialize exploded'
    );
  });

  it('a clean restore fires no degrade notice', async () => {
    const restore = recordingRestoreProcessors({ setup: aSetup });

    await importDataSources(
      [{ type: 'file', file: sessionFile(), fileType: 'application/json' }],
      restore.processors
    );

    expect(restore.completions).toHaveLength(1);
    expect(useMessageStore().messages).toEqual([]);
  });
});
