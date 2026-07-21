import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { importDataSources } from '@/src/io/import/importDataSources';
import { useMessageStore, MessageType } from '@/src/store/messages';

// ---------------------------------------------------------------------------
// Auto-degrade-to-ephemeral: a scene
// whose restore application throws mid-way degrades to an ephemeral open —
// already-loaded bases stay as plain datasets, ONE notice fires, and the
// import NEVER becomes an error loop or a rejected promise.
// ---------------------------------------------------------------------------

const processorMocks = vi.hoisted(() => ({
  restoreStateFile: vi.fn(),
  completeStateFileRestore: vi.fn(),
}));

vi.mock('@/src/io/import/processors/restoreStateFile', () => ({
  restoreStateFile: processorMocks.restoreStateFile,
  completeStateFileRestore: processorMocks.completeStateFileRestore,
}));

describe('importDataSources — degraded restore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    processorMocks.restoreStateFile.mockReset();
    processorMocks.completeStateFileRestore.mockReset();
  });

  it('a mid-restore throw degrades to an ephemeral open with ONE notice', async () => {
    processorMocks.restoreStateFile.mockResolvedValue({
      type: 'stateFileSetup',
      dataSources: [],
      manifest: { version: '6.4.0', dataSources: [] },
      stateFiles: [],
      missingFiles: [],
    });
    processorMocks.completeStateFileRestore.mockRejectedValue(
      new Error('segment group deserialize exploded')
    );

    const file = new File(['{}'], 'session.volview.json', {
      type: 'application/json',
    });
    const results = await importDataSources([
      { type: 'file', file, fileType: 'application/json' },
    ]);

    expect(results.filter((result) => result.type === 'error')).toEqual([]);

    const { messages } = useMessageStore();
    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe(MessageType.Warning);
    expect(messages[0].options.details).toContain(
      'segment group deserialize exploded'
    );
  });

  it('a clean restore fires no degrade notice', async () => {
    processorMocks.restoreStateFile.mockResolvedValue({
      type: 'stateFileSetup',
      dataSources: [],
      manifest: { version: '6.4.0', dataSources: [] },
      stateFiles: [],
      missingFiles: [],
    });
    processorMocks.completeStateFileRestore.mockResolvedValue(undefined);

    const file = new File(['{}'], 'session.volview.json', {
      type: 'application/json',
    });
    await importDataSources([
      { type: 'file', file, fileType: 'application/json' },
    ]);

    expect(processorMocks.completeStateFileRestore).toHaveBeenCalledTimes(1);
    expect(useMessageStore().messages).toEqual([]);
  });
});
