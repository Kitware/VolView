import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createEngineTransport } from '../transport';
import type { HttpError } from '../transport';
import type { ProcessingProviderConfig } from '@/src/processing/types';
import { setGlobalHeader, deleteGlobalHeader } from '@/src/utils/fetch';

type Call = { url: string; init: RequestInit | undefined };

// Same-origin base URLs: the global bearer is only attached same-origin.
const BASE = `${window.location.origin}/api/v1/folder/f1/volview_processing`;
const JOBS_BASE = `${window.location.origin}/api/v1/volview_processing`;

const config: ProcessingProviderConfig = {
  id: 'p1',
  label: 'Analysis — Folder',
  baseUrl: BASE,
  jobsBaseUrl: JOBS_BASE,
};

// Fixtures reach the real parsers, so every canned body must actually parse.
const FIXTURES = {
  tasks: [{ id: 'task-1', title: 'Threshold', description: 'd' }],
  spec: { specVersion: 1, id: 't', title: 'T', parameters: [], outputs: [] },
  run: { jobId: 'job-1' },
  status: { jobId: 'server-id', state: 'running', resultState: 'waiting' },
  results: {
    resultState: 'ready',
    intents: [
      {
        id: 'r1',
        name: 'out.nrrd',
        url: `${window.location.origin}/out.nrrd`,
        intent: 'add-base-image',
      },
    ],
    missing: 0,
  },
  cancel: {
    jobId: 'server-id',
    state: 'cancelled',
    resultState: 'unavailable',
  },
  detail: { jobId: 'job-1', log: ['done\n'], parameters: { threshold: '3' } },
  stage: { uris: ['/api/v1/file/abc/proxiable/seg.seg.nrrd'] },
  jobs: { jobs: [], nextCursor: null },
} as const;

const fixtureFor = (url: string): unknown => {
  const path = url.split('?')[0];
  if (path.endsWith('/spec')) return FIXTURES.spec;
  if (path.endsWith('/run')) return FIXTURES.run;
  if (path.endsWith('/results')) return FIXTURES.results;
  if (path.endsWith('/cancel')) return FIXTURES.cancel;
  if (path.endsWith('/detail')) return FIXTURES.detail;
  if (path.endsWith('/stage')) return FIXTURES.stage;
  if (path.endsWith('/tasks')) return FIXTURES.tasks;
  if (path.endsWith('/jobs')) return FIXTURES.jobs;
  if (/\/jobs\/[^/]+$/.test(path)) return FIXTURES.status;
  return {};
};

const stubFetch = (override?: (url: string) => unknown) => {
  const calls: Call[] = [];
  const stub = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const json = override ? override(u) : fixtureFor(u);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => json,
      text: async () => JSON.stringify(json),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', stub);
  return calls;
};

const authOf = (call: Call): string | null =>
  new Headers(call.init?.headers).get('Authorization');

const makeTransport = () => createEngineTransport(config);

describe('one required transport — fixed routes + $fetch', () => {
  beforeEach(() => {
    setGlobalHeader('Authorization', 'Bearer test-token');
  });
  afterEach(() => {
    deleteGlobalHeader('Authorization');
    vi.unstubAllGlobals();
  });

  it('constructs every fixed route from the correct base URL', async () => {
    const calls = stubFetch();
    const t = makeTransport();

    await t.listTasks();
    await t.getTaskSpec('threshold');
    await t.runTask('threshold', { radius: 3 });
    await t.getJob('job-1');
    await t.getResults('job-1');
    await t.cancelJob('job-1');
    await t.deleteJob('job-1');
    await t.getJobHistoryDetail('job-1');
    await t.listJobHistory();

    const urls = calls.map((c) => c.url);
    expect(urls[0]).toBe(`${BASE}/tasks`);
    expect(urls[1]).toBe(`${BASE}/tasks/threshold/spec`);
    expect(urls[2]).toBe(`${BASE}/tasks/threshold/run`);
    expect(urls[3]).toBe(`${JOBS_BASE}/jobs/job-1`);
    expect(urls[4]).toBe(`${JOBS_BASE}/jobs/job-1/results`);
    expect(urls[5]).toBe(`${JOBS_BASE}/jobs/job-1/cancel`);
    expect(urls[6]).toBe(`${JOBS_BASE}/jobs/job-1`);
    expect(urls[7]).toBe(`${JOBS_BASE}/jobs/job-1/detail`);
    expect(urls[8]).toBe(`${BASE}/jobs`);
  });

  it('percent-encodes a job id containing a slash', async () => {
    const calls = stubFetch();
    await makeTransport().getJob('a/b');
    expect(calls[0].url).toBe(`${JOBS_BASE}/jobs/a%2Fb`);
  });

  it('carries the global bearer on every call (never raw fetch)', async () => {
    const calls = stubFetch();
    const t = makeTransport();
    await t.getTaskSpec('t1');
    await t.runTask('t1', { radius: 3 });
    await t.getJob('j1');
    await t.getResults('j1');
    expect(calls.length).toBe(4);
    calls.forEach((c) => expect(authOf(c)).toBe('Bearer test-token'));
  });

  it('POSTs the run body as { values } JSON', async () => {
    const calls = stubFetch();
    await makeTransport().runTask('t1', { radius: 3 });
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBe(JSON.stringify({ values: { radius: 3 } }));
  });

  it('DELETEs a job through the job-addressed route', async () => {
    const calls = stubFetch();
    await makeTransport().deleteJob('job-1');
    expect(calls[0].url).toBe(`${JOBS_BASE}/jobs/job-1`);
    expect(calls[0].init?.method).toBe('DELETE');
  });

  it('parses tasks fail-soft: drops a malformed summary, keeps valid ones', async () => {
    stubFetch(() => [{ id: 'ok', title: 'OK' }, { id: 'bad-no-title' }]);
    const tasks = await makeTransport().listTasks();
    expect(tasks).toEqual([{ id: 'ok', title: 'OK' }]);
  });

  it('parses a non-array task payload as an empty list', async () => {
    stubFetch(() => ({ not: 'an array' }));
    expect(await makeTransport().listTasks()).toEqual([]);
  });

  it('parses the task spec envelope', async () => {
    stubFetch();
    const spec = await makeTransport().getTaskSpec('t');
    expect(spec.title).toBe('T');
  });

  it('parses the run response into a job ref', async () => {
    stubFetch();
    expect(await makeTransport().runTask('t', {})).toEqual({ jobId: 'job-1' });
  });

  it('parses job status, pinning the requested job id', async () => {
    stubFetch();
    const status = await makeTransport().getJob('job-9');
    expect(status).toMatchObject({
      jobId: 'job-9',
      state: 'running',
      resultState: 'waiting',
    });
  });

  it('parses the results envelope into the neutral bundle', async () => {
    stubFetch();
    const bundle = await makeTransport().getResults('job-1');
    expect(bundle.missing).toBe(0);
    expect(bundle.results[0].id).toBe('r1');
  });

  it('parses the projected status from a cancel', async () => {
    stubFetch();
    const status = await makeTransport().cancelJob('job-1');
    expect(status).toMatchObject({ jobId: 'job-1', state: 'cancelled' });
  });

  it('parses a job-history page and detail', async () => {
    stubFetch();
    const t = makeTransport();
    expect(await t.listJobHistory()).toEqual({ jobs: [], nextCursor: null });
    const detail = await t.getJobHistoryDetail('job-1');
    expect(detail.log).toEqual(['done\n']);
  });

  it('appends an opaque cursor to the history query', async () => {
    const calls = stubFetch();
    await makeTransport().listJobHistory('opaque cursor');
    expect(calls[0].url).toBe(`${BASE}/jobs?cursor=opaque%20cursor`);
  });

  const stubFetchNotOk = (status: number, body?: unknown) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status,
            statusText: 'ERR',
            json: async () => body,
            text: async () => text,
          }) as unknown as Response
      )
    );
  };

  const rejectionOf = async (promise: Promise<unknown>): Promise<HttpError> => {
    try {
      await promise;
    } catch (err) {
      return err as HttpError;
    }
    throw new Error('expected the operation to reject');
  };

  it('throws an HttpError carrying .status on a non-2xx JSON route', async () => {
    stubFetchNotOk(401);
    const err = await rejectionOf(makeTransport().getJob('job-1'));
    expect(err.status).toBe(401);
    expect(err.message).toContain('401');
  });

  it('carries .code and .body from a typed non-2xx error payload', async () => {
    const payload = { code: 'results_unavailable', message: 'job errored' };
    stubFetchNotOk(404, payload);
    const err = await rejectionOf(makeTransport().getResults('job-1'));
    expect(err.status).toBe(404);
    expect(err.code).toBe('results_unavailable');
    expect(err.body).toEqual(payload);
  });

  it('throws an HttpError carrying .status on a non-2xx empty route', async () => {
    stubFetchNotOk(401);
    const err = await rejectionOf(makeTransport().deleteJob('job-1'));
    expect(err.status).toBe(401);
  });

  it('stages a labelmap multipart resource and returns the minted URIs', async () => {
    const calls = stubFetch();
    const uris = await makeTransport().stageInput({
      file: new Blob(['bytes']),
      descriptor: {
        type: 'labelmap',
        name: 'seg.seg.nrrd',
        referenceImage: {
          type: 'image',
          uris: ['/api/v1/file/parent/proxiable/scan.nrrd'],
        },
      },
    });
    expect(uris).toEqual(['/api/v1/file/abc/proxiable/seg.seg.nrrd']);
    expect(calls[0].url).toBe(`${BASE}/stage`);
    expect(calls[0].init?.method).toBe('POST');
    expect(authOf(calls[0])).toBe('Bearer test-token');
    const form = calls[0].init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(await (form.get('file') as Blob).text()).toBe('bytes');
    expect(JSON.parse(form.get('descriptor') as string)).toMatchObject({
      type: 'labelmap',
      name: 'seg.seg.nrrd',
    });
  });
});
