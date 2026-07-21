import { describe, expect, it } from 'vitest';

import {
  JOB_STATES,
  RESULT_INTENTS,
  INTENT_VOCABULARY_VERSION,
  inputValueSchema,
  stageInputDescriptorSchema,
  neutralJobStatusSchema,
  resultIntentSchema,
  knownResultIntentSchema,
  jobHistoryPageSchema,
  jobHistorySummarySchema,
  jobHistoryDetailSchema,
  jobResultsSchema,
  jobResultsErrorSchema,
} from '../wire';
import { loadFixture, loadFixtureDir } from './loadFixtures';

const wire = Object.fromEntries(
  loadFixtureDir('wire').map((f) => [f.name, f.data])
);

// ---------------------------------------------------------------------------
// Input values
// ---------------------------------------------------------------------------

describe('input value fixtures', () => {
  it.each([
    'input-value.dicom-series',
    'input-value.single-file',
    'input-value.labelmap',
  ])('validates %s', (name) => {
    expect(() => inputValueSchema.parse(wire[name])).not.toThrow();
  });

  it('carries multiple URIs for a dicom-series image', () => {
    const value = inputValueSchema.parse(wire['input-value.dicom-series']);
    expect(value.type).toBe('image');
    expect(value.uris.length).toBeGreaterThan(1);
  });

  it('accepts the open `labelmap` type tag (no closed server enum)', () => {
    const value = inputValueSchema.parse(wire['input-value.labelmap']);
    expect(value.type).toBe('labelmap');
  });

  it('accepts an unknown/open type tag', () => {
    expect(() =>
      inputValueSchema.parse({ type: 'pet', uris: ['/x'] })
    ).not.toThrow();
  });

  it('rejects a bound input with no uris (negative fixture)', () => {
    const empty = loadFixture('negative/empty-uris.json');
    expect(inputValueSchema.safeParse(empty).success).toBe(false);
  });
});

describe('staged resource descriptor fixtures', () => {
  it('binds staged labelmap bytes to a durable reference image', () => {
    const descriptor = stageInputDescriptorSchema.parse(
      wire['stage-input.labelmap']
    );
    expect(descriptor.type).toBe('labelmap');
    expect(descriptor.referenceImage.type).toBe('image');
    expect(descriptor.referenceImage.uris).toHaveLength(2);
  });

  it('rejects a labelmap descriptor without reference provenance', () => {
    expect(
      stageInputDescriptorSchema.safeParse({
        type: 'labelmap',
        name: 'mask.seg.nrrd',
        referenceImage: { type: 'image', uris: [] },
      }).success
    ).toBe(false);
  });

  it('rejects undeclared reference-image descriptor fields', () => {
    expect(
      stageInputDescriptorSchema.safeParse({
        type: 'labelmap',
        name: 'mask.seg.nrrd',
        referenceImage: {
          type: 'image',
          uris: ['/x'],
          backendArtifactId: 'mixed-identity-channel',
        },
      }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Neutral status
// ---------------------------------------------------------------------------

describe('neutral job status fixtures', () => {
  it('has exactly the five v1 states, cancelled included', () => {
    expect([...JOB_STATES]).toEqual([
      'pending',
      'running',
      'success',
      'error',
      'cancelled',
    ]);
  });

  it.each([
    'status.pending',
    'status.running',
    'status.success',
    'status.error',
    'status.cancelled',
    'status.error-tail',
  ])('validates %s', (name) => {
    expect(() => neutralJobStatusSchema.parse(wire[name])).not.toThrow();
  });

  it('accepts cancelled with no wire change', () => {
    const s = neutralJobStatusSchema.parse(wire['status.cancelled']);
    expect(s.state).toBe('cancelled');
  });

  it('carries an errorTail on an errored job', () => {
    const s = neutralJobStatusSchema.parse(wire['status.error-tail']);
    expect(s.state).toBe('error');
    expect(s.errorTail).toBeTruthy();
  });

  it('rejects a state outside the five (e.g. the retired `queued`)', () => {
    // `queued`/`succeeded`/`failed` are rejected; the runtime names
    // (`pending`/`success`/`error`) are the valid five.
    expect(
      neutralJobStatusSchema.safeParse({ jobId: 'j', state: 'queued' }).success
    ).toBe(false);
  });

  it.each(['.', '..'])('rejects the dot-segment job id %j', (jobId) => {
    expect(
      neutralJobStatusSchema.safeParse({
        jobId,
        state: 'running',
        resultState: 'waiting',
      }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Result intents
// ---------------------------------------------------------------------------

describe('result intent fixtures', () => {
  it('exports vocabulary version 1 and the exactly-four state intents', () => {
    expect(INTENT_VOCABULARY_VERSION).toBe(1);
    expect([...RESULT_INTENTS]).toEqual([
      'add-base-image',
      'add-layer',
      'add-segment-group',
      'restore-state',
    ]);
    expect(wire).not.toHaveProperty('intent.download');
  });

  it.each([
    'intent.add-base-image',
    'intent.add-layer',
    'intent.add-segment-group.with-segments',
    'intent.add-segment-group.embedded',
    'intent.restore-state',
    'intent.unknown',
  ])('validates %s', (name) => {
    expect(() => resultIntentSchema.parse(wire[name])).not.toThrow();
  });

  it('parses add-segment-group WITH segments and a source provenance tag', () => {
    const parsed = resultIntentSchema.parse(
      wire['intent.add-segment-group.with-segments']
    ) as Record<string, unknown>;
    expect(parsed.intent).toBe('add-segment-group');
    expect(Array.isArray(parsed.segments)).toBe(true);
    expect(parsed.source).toEqual({
      providerId: 'analysis-provider',
      jobId: 'job-abc123',
      outputId: 'outputLabelmap',
    });
  });

  it('parses add-segment-group WITHOUT segments (embedded metadata) but with source', () => {
    const parsed = resultIntentSchema.parse(
      wire['intent.add-segment-group.embedded']
    ) as Record<string, unknown>;
    expect(parsed.intent).toBe('add-segment-group');
    expect(parsed.segments).toBeUndefined();
    expect(parsed.source).toMatchObject({ outputId: 'outputLabelmap' });
  });

  it('rejects a segment-group source without provider identity', () => {
    const value = structuredClone(
      wire['intent.add-segment-group.with-segments']
    ) as { source: { providerId?: string } };
    delete value.source.providerId;
    expect(knownResultIntentSchema.safeParse(value).success).toBe(false);
  });

  it('accepts an unknown intent as an ordinary result with no state action', () => {
    const parsed = resultIntentSchema.parse(wire['intent.unknown']) as Record<
      string,
      unknown
    >;
    // It parses (fail-open), but is not one of the known state actions.
    expect(
      knownResultIntentSchema.safeParse(wire['intent.unknown']).success
    ).toBe(false);
    expect(parsed.url).toBeTruthy();
    expect(parsed.name).toBeTruthy();
  });

  it.each([
    ['missing', { id: 'r1', url: '/report.csv', name: 'report.csv' }],
    [
      'malformed',
      { id: 'r1', intent: 17, url: '/report.csv', name: 'report.csv' },
    ],
  ])('accepts a %s intent as an ordinary result record', (_name, value) => {
    expect(() => resultIntentSchema.parse(value)).not.toThrow();
  });

  it('preserves null mimeType/size and extra producer fields on an ordinary result', () => {
    const parsed = resultIntentSchema.parse({
      id: 'r1',
      intent: 17,
      url: '/report.csv',
      name: 'report.csv',
      mimeType: null,
      size: null,
      producerHint: 'keep-me',
    }) as Record<string, unknown>;
    expect(parsed.mimeType).toBeNull();
    expect(parsed.size).toBeNull();
    // A catchall-preserved extra field survives without gaining behavior.
    expect(parsed.producerHint).toBe('keep-me');
  });

  it.each([
    ['a missing id', { url: '/x', name: 'x' }],
    ['an empty id', { id: '', url: '/x', name: 'x' }],
    [
      'a missing id on a known intent',
      {
        intent: 'add-base-image',
        url: '/x',
        name: 'x',
      },
    ],
    [
      'an empty id on a known intent',
      {
        id: '',
        intent: 'add-base-image',
        url: '/x',
        name: 'x',
      },
    ],
  ])('rejects a result row with %s', (_name, value) => {
    expect(resultIntentSchema.safeParse(value).success).toBe(false);
  });

  it('still rejects a result that is not even a file reference', () => {
    expect(
      resultIntentSchema.safeParse({ id: 'r1', intent: 'add-polygon' }).success
    ).toBe(false);
  });

  it('rejects a wrong-length segment color (the tuple-length parity pin)', () => {
    // The negative fixture carries a 3-element color. The STRICT union must
    // reject it — and the generated JSON Schema must agree (backend side:
    // test_contract_fixtures.py), so both validators close fixed-length
    // tuples identically. The full union still accepts the row, demoted to an
    // ordinary result with no state action (the designed fail-open).
    const short = loadFixture('negative/wrong-length-color.json');
    expect(knownResultIntentSchema.safeParse(short).success).toBe(false);
    expect(resultIntentSchema.safeParse(short).success).toBe(true);

    const good = wire['intent.add-segment-group.with-segments'] as {
      segments: { color: number[] }[];
    };
    const long = structuredClone(good);
    long.segments[0].color = [255, 0, 0, 255, 255];
    expect(knownResultIntentSchema.safeParse(long).success).toBe(false);
    expect(knownResultIntentSchema.safeParse(good).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Durable job-history handle + result-read payloads
// ---------------------------------------------------------------------------

describe('durable job-history handle + result-read payloads', () => {
  it('validates job-history summary, page, and detail fixtures', () => {
    expect(
      jobHistorySummarySchema.parse(wire['job-history-summary']).state
    ).toBe('success');
    expect(
      jobHistoryPageSchema.parse(wire['job-history-page']).nextCursor
    ).toBe('opaque-continuation');
    expect(
      jobHistoryDetailSchema.parse(wire['job-history-detail']).log
    ).toEqual(['completed\n']);
  });

  it('rejects an impossible job-history lifecycle pairing', () => {
    // Parse the fixture first so the spread has a typed object source (the raw
    // fixture is `unknown`, which cannot be spread — TS2698).
    const summary = jobHistorySummarySchema.parse(wire['job-history-summary']);
    const parsed = jobHistorySummarySchema.safeParse({
      ...summary,
      state: 'success',
      resultState: 'waiting',
    });
    expect(parsed.success).toBe(false);
  });

  it('validates the pinned lightweight job-history page', () => {
    const page = jobHistoryPageSchema.parse({
      jobs: [
        {
          jobId: 'job-1',
          taskId: 'task-1',
          taskTitle: 'Threshold',
          createdBy: { id: 'user-1', name: 'Ada Lovelace' },
          createdAt: '2026-06-01T12:00:00Z',
          startedAt: '2026-06-01T12:00:01Z',
          finishedAt: '2026-06-01T12:00:05Z',
          state: 'success',
          resultState: 'incomplete',
          progress: 1,
          outputSummary: {
            recorded: 2,
            missing: 1,
          },
        },
      ],
      nextCursor: 'opaque-value',
    });
    expect(page.jobs[0].taskTitle).toBe('Threshold');
    expect(page.nextCursor).toBe('opaque-value');
    expect(page.jobs[0]).not.toHaveProperty('inputUris');
    expect(page.jobs[0]).not.toHaveProperty('log');
    expect(page.jobs[0]).not.toHaveProperty('params');
  });
  it('validates a getJobResults success payload with a missing count', () => {
    const results = jobResultsSchema.parse(wire['job-results.missing']);
    expect(results.missing).toBe(2);
    expect(results.intents.length).toBe(1);
  });

  it('validates a getJobResults error payload (non-success)', () => {
    const err = jobResultsErrorSchema.parse(wire['job-results.error']);
    expect(err.message).toBeTruthy();
    expect(err.code).toBe('results_unavailable');
    expect(err.state).toBe('error');
  });
});
