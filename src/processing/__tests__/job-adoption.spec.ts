import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  appApplyDependencies,
  autoLoadProcessingResults,
} from '@/src/processing/applyResults';
import { useProcessingJobsStore } from '@/src/processing/store';
import type { ProcessingResult } from '@/src/processing/types';
import {
  seatDataSource,
  seatVolume,
} from '@/src/store/__tests__/datasetFixtures';
import {
  seatImage,
  serializeAnnotations,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

const jobRef = { providerId: 'analysis', jobId: 'saved-job' };
const baseUris = ['/ct/2.dcm', '/ct/1.dcm'];
const layerUris = ['/pet/1.dcm', '/pet/2.dcm'];

const rulerFile = {
  schemaVersion: 1,
  space: 'LPS',
  labels: {
    rulers: { Tumor: { color: '#ff0000', strokeWidth: 3 } },
    rectangles: {},
    polygons: {},
  },
  tools: {
    rulers: [
      {
        name: 'Long axis',
        labelName: 'Tumor',
        firstPoint: [1, 1, 2],
        secondPoint: [4, 1, 2],
        frameOfReference: {
          planeNormal: [0, 0, 1],
          planeOrigin: [0, 0, 2],
        },
      },
    ],
    rectangles: [],
    polygons: [],
  },
};

const result: ProcessingResult = {
  intent: 'add-annotations',
  id: 'rulers',
  name: 'measurements.annotations.json',
  url: '/measurements.annotations.json',
  source: { ...jobRef, outputId: 'outputAnnotations' },
};

const loadVolume = async (id: string, uris: string[]) => {
  await seatImage(id, { dimensions: [8, 8, 8] });
  seatVolume(id);
  seatDataSource(id, {
    type: 'collection',
    sources: uris.map((uri) => ({ type: 'uri', uri, name: uri })),
  });
};

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adopting jobs with base and layer inputs', () => {
  it.each([
    { baseLoaded: true, baseSubmitted: true, expectedCount: 1 },
    { baseLoaded: false, baseSubmitted: true, expectedCount: 0 },
    { baseLoaded: true, baseSubmitted: false, expectedCount: 0 },
  ])(
    'restores only the named base with loaded=$baseLoaded, submitted=$baseSubmitted',
    async ({ baseLoaded, baseSubmitted, expectedCount }) => {
      if (baseLoaded) await loadVolume('base-ct', [...baseUris].reverse());
      await loadVolume('pet-layer', layerUris);
      const detail = {
        jobId: jobRef.jobId,
        log: [],
        parameters: {
          absentLayer: null,
          inputPETVolume: { type: 'image', uris: layerUris },
          inputTools: { type: 'annotations', uris: ['/tools.json'] },
          ...(baseSubmitted
            ? { inputVolume: { type: 'image', uris: baseUris } }
            : {}),
        },
        referenceImageParameter: 'inputVolume',
      };
      const history = {
        jobs: [
          {
            jobId: jobRef.jobId,
            taskId: 'measure',
            taskTitle: 'Measure segments',
            createdBy: { id: 'reader', name: 'Reader' },
            createdAt: '2026-10-21T12:00:00Z',
            state: 'success',
            resultState: 'ready',
            outputSummary: { recorded: 1, missing: 0 },
          },
        ],
        nextCursor: null,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const path = new URL(String(input), window.location.origin).pathname;
          let payload: unknown;
          if (path.endsWith('/detail')) payload = detail;
          else if (path.endsWith('/results'))
            payload = { resultState: 'ready', intents: [result], missing: 0 };
          else if (path === '/analysis/jobs') payload = history;
          else throw new Error(`Unexpected request: ${path}`);
          return new Response(JSON.stringify(payload), {
            headers: { 'Content-Type': 'application/json' },
          });
        })
      );
      const jobs = useProcessingJobsStore();
      jobs.registerProviderConfig({
        id: jobRef.providerId,
        label: 'Analysis',
        baseUrl: '/analysis',
        jobsBaseUrl: '/analysis',
      });

      await jobs.adoptJobHistory();
      await jobs.loadJobResults(jobRef);
      await jobs.applyJobResults(jobRef, (pending, submitted) =>
        autoLoadProcessingResults(pending, submitted, {
          ...appApplyDependencies(),
          fetchResult: async () =>
            new File([JSON.stringify(rulerFile)], result.name),
        })
      );

      const savedRulers = serializeAnnotations().tools?.rulers?.tools ?? [];
      if (expectedCount) {
        expect(savedRulers).toMatchObject([
          {
            imageID: 'base-ct',
            name: 'Long axis',
            firstPoint: [1, 1, 2],
            secondPoint: [4, 1, 2],
          },
        ]);
        expect(savedRulers).toHaveLength(1);
      } else {
        expect(savedRulers).toEqual([]);
      }
    }
  );
});
