import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { importDataSources } from '@/src/io/import/importDataSources';
import {
  recordingRestoreProcessors,
  yields,
} from '@/src/io/import/__tests__/restoreProcessorFixtures';
import { useRectangleStore } from '@/src/store/tools/rectangles';

const sessionFile = () =>
  new File(['{}'], 'session.volview.json', { type: 'application/json' });

const configFile = () =>
  new File(
    [
      JSON.stringify({
        labels: {
          rectangleLabels: {
            Configured: { color: '#0000ff', fillColor: '#0000ff33' },
          },
        },
      }),
    ],
    'config.json',
    { type: 'application/json' }
  );

const setup = yields({
  type: 'stateFileSetup',
  dataSources: [],
  manifest: { version: '7.0.0', dataSources: [] },
  stateFiles: [],
  missingFiles: [],
});

describe('post-state label config', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('applies config labels after restored templates', async () => {
    let configWasVisibleDuringRestore = false;
    const restore = recordingRestoreProcessors({
      setup,
      completion: async () => {
        const rectangles = useRectangleStore();
        configWasVisibleDuringRestore = Object.values(rectangles.labels).some(
          (label) => label.labelName === 'Configured'
        );
        rectangles.deserializeTools(
          {
            tools: [
              {
                imageID: 'img-1',
                label: 'config-label:Restored',
                placing: false,
              },
            ],
            templates: {
              Restored: { color: '#00ff00', fillColor: '#00ff0033' },
            },
          },
          { 'img-1': 'img-1' }
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

    expect(configWasVisibleDuringRestore).toBe(false);
    expect(
      Object.values(useRectangleStore().labels).map((label) => label.labelName)
    ).toEqual(['Restored', 'Configured']);
    const rectangles = useRectangleStore();
    expect(rectangles.toolByID[rectangles.toolIDs[0]]).toMatchObject({
      labelName: 'Restored',
      color: '#00ff00',
      fillColor: '#00ff0033',
    });
  });
});
