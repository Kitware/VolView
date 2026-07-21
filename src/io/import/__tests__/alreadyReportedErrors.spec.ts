import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { importDataSources } from '@/src/io/import/importDataSources';
import type { DataSource } from '@/src/io/import/dataSource';
import type { ErrorResult } from '@/src/io/import/common';
import { Skip } from '@/src/utils/evaluateChain';

// ---------------------------------------------------------------------------
// importDataSources owns the "already reported" knowledge: a failed
// state-file leaf is counted by the restore's consolidated missing-content
// notice, so its error result comes back flagged `alreadyReported` — callers
// suppress on the flag alone, without re-deriving restore internals. The flag
// is set ONLY when the notice actually ran: a leaf error with no completed
// restore behind it must surface through the generic load-error path.
// ---------------------------------------------------------------------------

const processorMocks = vi.hoisted(() => ({
  restoreStateFile: vi.fn(),
  completeStateFileRestore: vi.fn(),
}));

vi.mock('@/src/io/import/processors/restoreStateFile', () => ({
  restoreStateFile: processorMocks.restoreStateFile,
  completeStateFileRestore: processorMocks.completeStateFileRestore,
}));

// Garbage bytes with no recognizable magic: updateFileMimeType throws
// "Unrecognized file type", producing an error result deterministically
// (no network, no readers).
const unrecognizedFile = (name: string) =>
  new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], name);

const sessionFile = () =>
  new File(['{}'], 'session.volview.json', { type: 'application/json' });

// Emits the setup for the session file only; every re-queued leaf source
// skips through to the ordinary processors (and fails there).
const mockSetupWith = (leafSources: DataSource[]) => {
  processorMocks.restoreStateFile.mockImplementation((ds: DataSource) => {
    if (ds.type === 'file' && ds.file.name === 'session.volview.json') {
      return {
        type: 'stateFileSetup',
        dataSources: leafSources,
        manifest: { version: '6.4.0', dataSources: [] },
        stateFiles: [],
        missingFiles: [],
      };
    }
    return Skip;
  });
};

const failingErrors = async (sources: DataSource[]) => {
  const results = await importDataSources(sources);
  return results.filter((r): r is ErrorResult => r.type === 'error');
};

describe('importDataSources — alreadyReported flag on error results', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    processorMocks.restoreStateFile.mockReset();
    processorMocks.completeStateFileRestore.mockReset();
    processorMocks.restoreStateFile.mockReturnValue(Skip);
  });

  it('flags a failed leaf covered by a completed restore notice', async () => {
    mockSetupWith([
      {
        type: 'file',
        file: unrecognizedFile('ds-a.bin'),
        fileType: '',
        stateFileLeaf: { stateID: 'ds-a' },
      },
    ]);
    processorMocks.completeStateFileRestore.mockResolvedValue(undefined);

    const errors = await failingErrors([
      { type: 'file', file: sessionFile(), fileType: 'application/json' },
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0].alreadyReported).toBe(true);
  });

  it('flags a covered failure whose leaf sits higher up the source chain', async () => {
    const leafParent: DataSource = {
      type: 'uri',
      uri: 'https://girder.example/file/ds-a',
      name: 'ds-a.nrrd',
      stateFileLeaf: { stateID: 'ds-a' },
    };
    mockSetupWith([
      {
        type: 'file',
        file: unrecognizedFile('ds-a.bin'),
        fileType: '',
        parent: leafParent,
      },
    ]);
    processorMocks.completeStateFileRestore.mockResolvedValue(undefined);

    const errors = await failingErrors([
      { type: 'file', file: sessionFile(), fileType: 'application/json' },
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0].alreadyReported).toBe(true);
  });

  it('hands the restore the failed leaves for its consolidated notice', async () => {
    mockSetupWith([
      {
        type: 'file',
        file: unrecognizedFile('ds-a.bin'),
        fileType: '',
        stateFileLeaf: { stateID: 'ds-a' },
      },
    ]);
    processorMocks.completeStateFileRestore.mockResolvedValue(undefined);

    await importDataSources([
      { type: 'file', file: sessionFile(), fileType: 'application/json' },
    ]);

    const failedLeaves = processorMocks.completeStateFileRestore.mock
      .calls[0][4] as Array<{ stateID: string; name: string }>;
    expect(failedLeaves).toEqual([{ stateID: 'ds-a', name: 'ds-a.bin' }]);
  });

  it('does not flag a leaf failure when the restore never completed', async () => {
    mockSetupWith([
      {
        type: 'file',
        file: unrecognizedFile('ds-a.bin'),
        fileType: '',
        stateFileLeaf: { stateID: 'ds-a' },
      },
    ]);
    processorMocks.completeStateFileRestore.mockRejectedValue(
      new Error('deserialize exploded')
    );

    const errors = await failingErrors([
      { type: 'file', file: sessionFile(), fileType: 'application/json' },
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0].alreadyReported).toBeFalsy();
  });

  it('does not flag a leaf-carrying failure with no restore behind it', async () => {
    const errors = await failingErrors([
      {
        type: 'file',
        file: unrecognizedFile('ds-a.bin'),
        fileType: '',
        stateFileLeaf: { stateID: 'ds-a' },
      },
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0].alreadyReported).toBeFalsy();
  });

  it('does not flag a standalone failure', async () => {
    const errors = await failingErrors([
      { type: 'file', file: unrecognizedFile('plain.bin'), fileType: '' },
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0].alreadyReported).toBeFalsy();
  });
});
