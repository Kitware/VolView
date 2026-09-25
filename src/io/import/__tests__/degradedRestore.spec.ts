import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { importDataSources } from '@/src/io/import/importDataSources';
import {
  messageTitles,
  mountMessageCenter,
} from '@/src/components/__tests__/messageDisplay';
import {
  recordingRestoreProcessors,
  yields,
} from '@/src/io/import/__tests__/restoreProcessorFixtures';

const aSetup = yields({
  type: 'stateFileSetup',
  dataSources: [],
  manifest: { version: '6.4.0', dataSources: [] },
  stateFiles: [],
  missingFiles: [],
});

const sessionFile = () =>
  new File(['{}'], 'session.volview.json', { type: 'application/json' });

describe('importDataSources degraded restore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('a mid-restore throw degrades to an ephemeral open with ONE notice', async () => {
    const restore = recordingRestoreProcessors({
      setup: aSetup,
      completion: async () => {
        throw new Error('Segmentation restore failed');
      },
    });

    const results = await importDataSources(
      [{ type: 'file', file: sessionFile(), fileType: 'application/json' }],
      restore.processors
    );

    expect(results.filter((result) => result.type === 'error')).toEqual([]);

    const messages = mountMessageCenter();
    expect(messages.findAll('.header > span')).toHaveLength(1);
    expect(messages.findAll('.warn-message')).toHaveLength(1);
    expect(messages.get('.details').text()).toContain(
      'Segmentation restore failed'
    );
  });

  it('a clean restore fires no degrade notice', async () => {
    const restore = recordingRestoreProcessors({ setup: aSetup });

    await importDataSources(
      [{ type: 'file', file: sessionFile(), fileType: 'application/json' }],
      restore.processors
    );

    expect(restore.completions).toHaveLength(1);
    expect(messageTitles()).toEqual([]);
  });
});
