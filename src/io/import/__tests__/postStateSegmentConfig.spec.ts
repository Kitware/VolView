import { Skip } from '@/src/utils/evaluateChain';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import JSZip from 'jszip';
import { manifestForImages } from '@/src/segmentation/__tests__/segmentMaskFixtures';

import { importDataSources } from '@/src/io/import/importDataSources';
import {
  recordingRestoreProcessors,
  yieldsFor,
} from '@/src/io/import/__tests__/restoreProcessorFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';

const sessionFile = () =>
  new File(['{}'], 'session.volview.json', { type: 'application/json' });

const configFile = () =>
  new File(
    [
      JSON.stringify({
        segments: {
          Configured: { color: '#0000ff' },
        },
      }),
    ],
    'config.json',
    { type: 'application/json' }
  );

const RESTORED_MANIFEST = {
  version: '7.0.0',
  dataSources: [],
  segments: [
    {
      id: 'wire-restored',
      name: 'Restored',
      color: [0, 255, 0, 255] as [number, number, number, number],
      visible: true,
      locked: false,
    },
  ],
};

const setup = yieldsFor((source) =>
  source.type === 'file' && source.file.name === 'session.volview.json'
    ? {
        type: 'stateFileSetup',
        dataSources: [],
        manifest: RESTORED_MANIFEST,
        stateFiles: [],
        missingFiles: [],
      }
    : Skip
);

describe('post-state segment config', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('applies configured segments after the restored registry', async () => {
    let configWasVisibleDuringRestore = false;
    const restore = recordingRestoreProcessors({
      setup,
      completion: async () => {
        useSegmentStore().deserialize(RESTORED_MANIFEST);
        configWasVisibleDuringRestore =
          !!useSegmentStore().segments.findSegmentByName('Configured');
      },
    });

    await importDataSources(
      [
        {
          type: 'file',
          file: sessionFile(),
          fileType: 'application/json',
        },
        {
          type: 'file',
          file: configFile(),
          fileType: 'application/json',
        },
      ],
      restore.processors
    );
    await nextTick();

    // Restore seats its registry first; the config layers on top of it.
    expect(configWasVisibleDuringRestore).toBe(false);
    const manifest = manifestForImages([]);
    useSegmentStore().serialize({ zip: new JSZip(), manifest });
    expect(manifest.segments?.map((segment) => segment.name)).toEqual([
      'Restored',
      'Configured',
    ]);
  });
});
