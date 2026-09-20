import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { importDataSources } from '@/src/io/import/importDataSources';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';

// A manifest's top-level `segments` is also a config key, so a session JSON
// that fails its schema must still be reported as a state file.
describe('a session JSON that fails its schema', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('is reported as a state file rather than as config', async () => {
    const manifest = {
      version: MANIFEST_VERSION,
      dataSources: [{ id: 0, type: 'uri', uri: 'https://example.com/ct.nrrd' }],
      segments: [
        { id: 's', name: 'Tumor', color: 'red', visible: true, locked: false },
      ],
    };
    const file = new File([JSON.stringify(manifest)], 'session.volview.json', {
      type: 'application/json',
    });

    const results = await importDataSources([
      { type: 'file', file, fileType: 'application/json' },
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          message: expect.stringMatching(
            /^Unsupported state file schema or version: /
          ),
        }),
      }),
    ]);
  });
});
