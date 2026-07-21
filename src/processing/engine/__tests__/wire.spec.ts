import { describe, expect, it } from 'vitest';

import {
  parseJobHistoryPage,
  parseJobRef,
  parseJobStatus,
  parseResults,
} from '@/src/processing/engine/wire';
import type {
  ProcessingJobStatus,
  ProcessingResult,
} from '@/src/processing/types';
import { loadFixture } from '@/backend-contract/processing/__tests__/loadFixtures';

describe('parseJobStatus', () => {
  it('passes a valid status through byte-identically', () => {
    const status: ProcessingJobStatus = {
      jobId: 'job-1',
      state: 'running',
      resultState: 'waiting',
      progress: 0.4,
    };
    expect(parseJobStatus('job-1', status)).toEqual(status);
  });

  it('accepts every declared terminal/non-terminal state', () => {
    (
      [
        ['pending', 'waiting'],
        ['running', 'waiting'],
        ['success', 'ready'],
        ['error', 'unavailable'],
        ['cancelled', 'unavailable'],
      ] as const
    ).forEach(([state, resultState]) => {
      expect(
        parseJobStatus('job-1', { jobId: 'job-1', state, resultState }).state
      ).toBe(state);
    });
  });

  it('rejects an execution/result-state pairing the contract cannot produce', () => {
    const result = parseJobStatus('job-1', {
      jobId: 'job-1',
      state: 'success',
      resultState: 'waiting',
    });
    expect(result.state).toBe('error');
    expect(result.resultState).toBe('unavailable');
    expect(result.errorTail).toContain('Malformed job status');
  });

  it('preserves unknown wire keys on the happy path', () => {
    const raw = {
      jobId: 'job-1',
      state: 'success',
      resultState: 'ready',
      extra: 'keep-me',
    };
    expect(parseJobStatus('job-1', raw)).toMatchObject({ extra: 'keep-me' });
  });

  it('converts an unknown state into a terminal error keyed to the requested job', () => {
    const result = parseJobStatus('job-1', {
      jobId: 'job-1',
      state: 'who-knows',
    });
    expect(result.jobId).toBe('job-1');
    expect(result.state).toBe('error');
    expect(result.errorTail).toContain('Malformed job status');
  });

  it('converts a missing state into a terminal error', () => {
    expect(parseJobStatus('job-1', { jobId: 'job-1' }).state).toBe('error');
  });

  it('pins a valid status to the requested jobId, not the returned one', () => {
    const status = parseJobStatus('job-1', {
      jobId: 'something-else',
      state: 'success',
      resultState: 'ready',
    });
    expect(status.jobId).toBe('job-1');
    expect(status.state).toBe('success');
  });

  it('converts a non-object payload into a terminal error', () => {
    expect(parseJobStatus('job-1', 'nonsense').state).toBe('error');
    expect(parseJobStatus('job-1', null).state).toBe('error');
  });
});

describe('parseJobRef', () => {
  it('parses a ref with no initial status (async/poll path)', () => {
    expect(parseJobRef({ jobId: 'job-1' })).toEqual({ jobId: 'job-1' });
  });

  it('treats an explicit status:null as absent (poll path), not a terminal error', () => {
    expect(parseJobRef({ jobId: 'job-1', status: null })).toEqual({
      jobId: 'job-1',
    });
  });

  it('parses a born-terminal ref with a valid status', () => {
    const status: ProcessingJobStatus = {
      jobId: 'job-1',
      state: 'success',
      resultState: 'ready',
    };
    expect(parseJobRef({ jobId: 'job-1', status })).toEqual({
      jobId: 'job-1',
      status,
    });
  });

  it('turns a malformed born-terminal status into a terminal error, not an infinite poll', () => {
    const ref = parseJobRef({
      jobId: 'job-1',
      status: { jobId: 'job-1', state: 'bogus' },
    });
    expect(ref.jobId).toBe('job-1');
    expect(ref.status?.state).toBe('error');
  });

  it.each([
    ['a missing job id', { status: { state: 'success' } }],
    ['an empty job id', { jobId: '' }],
    ['a non-string job id', { jobId: 42 }],
  ])('throws on a ref with %s', (_label, input) => {
    expect(() => parseJobRef(input)).toThrow(/Malformed job ref/);
  });
});

describe('parseResults', () => {
  const validItems: ProcessingResult[] = [
    { id: 'r1', name: 'out.nrrd', url: 'https://example/out.nrrd' },
  ];

  it('parses the {intents, missing} envelope into {results, missing}', () => {
    const { results, missing } = parseResults({
      resultState: 'incomplete',
      intents: validItems,
      missing: 2,
    });
    expect(results).toEqual(validItems);
    expect(missing).toBe(2);
  });

  it('rejects an envelope without required readiness and missing fields', () => {
    expect(() => parseResults({ intents: validItems })).toThrow(
      /Malformed job results/
    );
  });

  it('preserves a segment-group result with descriptors and unknown keys', () => {
    const intents = [
      {
        id: 'r1',
        name: 'seg.nrrd',
        url: 'https://example/seg.nrrd',
        intent: 'add-segment-group',
        segments: [{ value: 1, name: 'liver', color: [255, 0, 0, 255] }],
        extra: 'keep-me',
      },
    ];
    expect(
      parseResults({ resultState: 'ready', intents, missing: 0 }).results
    ).toEqual(intents);
  });

  it('keeps an out-of-range segment descriptor as an ordinary result (no whole-list rejection)', () => {
    const intents = [
      {
        id: 'r1',
        name: 'seg.nrrd',
        url: 'https://example/seg.nrrd',
        intent: 'add-segment-group',
        segments: [{ value: 0, name: 'bg', color: [300, -5, 0, 255] }],
      },
    ];
    expect(
      parseResults({ resultState: 'ready', intents, missing: 0 }).results
    ).toEqual(intents);
  });

  it('keeps a numeric/malformed intent as an ordinary result (never throws the list away)', () => {
    const intents = [
      {
        id: 'r1',
        name: 'report.csv',
        url: 'https://example/report.csv',
        intent: 17,
      },
    ];
    const { results } = parseResults({
      resultState: 'ready',
      intents,
      missing: 0,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 'r1', name: 'report.csv' });
  });

  it.each([
    ['a missing id', { name: 'x', url: 'https://example/x' }],
    ['an empty id', { id: '', name: 'x', url: 'https://example/x' }],
  ])('throws when a result row has %s', (_name, item) => {
    expect(() =>
      parseResults({ resultState: 'ready', intents: [item], missing: 0 })
    ).toThrow(/Malformed job results/);
  });

  it('tolerates null mimeType/size (the backend emits absent file fields as null)', () => {
    const intents = [
      {
        id: 'r1',
        name: 'out.nrrd',
        url: 'https://example/out.nrrd',
        mimeType: null,
        size: null,
      },
    ];
    const { results } = parseResults({
      resultState: 'ready',
      intents,
      missing: 0,
    });
    expect(results[0]).toMatchObject({ id: 'r1', name: 'out.nrrd' });
    expect(results[0].mimeType).toBeUndefined();
    expect(results[0].size).toBeUndefined();
  });

  it('exercises the job-results.missing.json wire fixture', () => {
    const fixture = loadFixture('wire/job-results.missing.json') as {
      intents: Array<Record<string, unknown>>;
      missing: number;
    };
    expect(fixture.missing).toBe(2);
    const enriched = {
      ...fixture,
      intents: fixture.intents.map((intent, n) => ({
        id: `out-${n}`,
        ...intent,
      })),
    };
    const { results, missing } = parseResults(enriched);
    expect(missing).toBe(2);
    expect(results).toHaveLength(1);
    expect(results[0].intent).toBe('add-base-image');
  });

  it('throws on a bare list — the pre-envelope shape is no longer accepted', () => {
    expect(() => parseResults(validItems)).toThrow(/Malformed job results/);
  });

  it('throws on a non-object payload', () => {
    expect(() => parseResults({ id: 'r1' })).toThrow(/Malformed job results/);
  });

  it('throws when a result item is missing a required field', () => {
    expect(() =>
      parseResults({ intents: [{ id: 'r1', name: 'out.nrrd' }] })
    ).toThrow(/Malformed job results/);
  });
});

describe('parseJobHistoryPage (durable job-history)', () => {
  const summary = {
    jobId: 'job-abc123',
    taskId: 'OtsuSegmentation',
    taskTitle: 'Otsu segmentation',
    createdBy: { id: 'u1', name: 'User One' },
    createdAt: '2026-07-03T18:24:00Z',
    finishedAt: '2026-07-03T18:24:05.123000+00:00',
    state: 'success',
    resultState: 'ready',
  };

  it('passes a valid JobHistoryPage through', () => {
    const page = { jobs: [summary], nextCursor: 'opaque' };
    expect(parseJobHistoryPage(page)).toEqual(page);
    expect(parseJobHistoryPage({ jobs: [], nextCursor: null })).toEqual({
      jobs: [],
      nextCursor: null,
    });
  });

  it('throws on a non-page or malformed summary', () => {
    expect(() => parseJobHistoryPage({ jobId: 'x' })).toThrow(
      /Malformed job history page/
    );
    expect(() =>
      parseJobHistoryPage({ jobs: [{ jobId: 'j' }], nextCursor: null })
    ).toThrow(/Malformed job history page/);
  });
});
