import { Skip } from '@/src/utils/evaluateChain';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { importDataSources } from '@/src/io/import/importDataSources';
import {
  recordingRestoreProcessors,
  yieldsFor,
} from '@/src/io/import/__tests__/restoreProcessorFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useRectangleStore } from '@/src/store/tools/rectangles';

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

describe('post-state segment type config', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('applies configured segments after the restored registry', async () => {
    let configWasVisibleDuringRestore = false;
    const restore = recordingRestoreProcessors({
      setup,
      completion: async () => {
        const segmentIdMap = useSegmentStore().deserialize(RESTORED_MANIFEST);
        configWasVisibleDuringRestore =
          !!useSegmentStore().segments.findSegmentByName('Configured');
        useRectangleStore().deserializeTools(
          {
            tools: [
              {
                imageID: 'img-1',
                segmentId: 'wire-restored',
                placing: false,
              },
            ],
          },
          { 'img-1': 'img-1' },
          segmentIdMap
        );
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
    const rectangles = useRectangleStore();
    expect(
      rectangles.segments.segmentList.value.map((type) => type.name)
    ).toEqual(['Restored', 'Configured']);
    const tool = rectangles.toolByID[rectangles.toolIDs[0]];
    expect(rectangles.appearanceOfTool(tool.id)).toMatchObject({
      name: 'Restored',
      cssColor: '#00ff00',
    });
  });
});
