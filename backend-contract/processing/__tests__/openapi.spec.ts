import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument, NEUTRAL_OPERATION_IDS } from '../openapi';
import { JOB_STATES, RESULT_INTENTS } from '../wire';

// The published OpenAPI is the backend's obligation surface.
// These are its guards: it stays in sync with the single zod source, covers
// exactly the neutral client-invoked endpoints, resolves every $ref, and — the
// whole point — leaks NOTHING Girder-specific (AC1: a reviewer enumerates the
// backend obligation without reading girder_volview source).

const here = dirname(fileURLToPath(import.meta.url));
const openapiPath = resolve(here, '..', '..', 'generated', 'openapi.json');

const doc = buildOpenApiDocument();

const get = (obj: unknown, key: string): unknown =>
  (obj as Record<string, unknown>)[key];

const schemaComponents = () =>
  get(get(doc, 'components'), 'schemas') as Record<string, unknown>;

type FoundOp = { method: string; path: string; operationId?: string };

const operations = (): FoundOp[] => {
  const found: FoundOp[] = [];
  const pathItems = get(doc, 'paths') as Record<string, unknown>;
  for (const [path, methods] of Object.entries(pathItems)) {
    for (const [method, op] of Object.entries(
      methods as Record<string, unknown>
    )) {
      found.push({
        method,
        path,
        operationId: get(op, 'operationId') as string | undefined,
      });
    }
  }
  return found;
};

const collectRefs = (node: unknown, acc: string[] = []): string[] => {
  if (Array.isArray(node)) {
    node.forEach((n) => collectRefs(n, acc));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') acc.push(value);
      else collectRefs(value, acc);
    }
  }
  return acc;
};

// ---------------------------------------------------------------------------
// Drift — the checked-in artifact equals what the source builds right now
// ---------------------------------------------------------------------------

describe('published OpenAPI is in sync with the source', () => {
  it('generated/openapi.json matches buildOpenApiDocument()', () => {
    const onDisk = JSON.parse(readFileSync(openapiPath, 'utf-8'));
    expect(onDisk).toEqual(doc);
  });

  it('package.json version equals the OpenAPI artifact version', () => {
    // The two halves of the artifact version (README "Versioning and
    // stability") — a bump that touches only one of them is drift.
    const pkg = JSON.parse(
      readFileSync(resolve(here, '..', '..', 'package.json'), 'utf-8')
    );
    expect(pkg.version).toBe(get(get(doc, 'info'), 'version'));
  });
});

// ---------------------------------------------------------------------------
// Completeness — exactly the neutral client-invoked surface
// ---------------------------------------------------------------------------

describe('covers exactly the neutral client-invoked surface', () => {
  it('exposes every neutral operationId and no others', () => {
    // The published surface is exactly the processing ops (Seams 1-3).
    const ids = operations()
      .map((o) => o.operationId)
      .sort();
    expect(ids).toEqual([...NEUTRAL_OPERATION_IDS].sort());
  });

  it('every operation carries an operationId', () => {
    expect(operations().every((o) => Boolean(o.operationId))).toBe(true);
  });

  it('job-addressed routes are keyed by jobId alone (no context in path)', () => {
    const jobOps = operations().filter((o) =>
      ['getJob', 'getJobResults', 'cancelJob'].includes(o.operationId ?? '')
    );
    expect(jobOps).toHaveLength(3);
    jobOps.forEach((o) => {
      expect(o.path.startsWith('/jobs/{jobId}')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// $ref integrity — every component reference resolves
// ---------------------------------------------------------------------------

describe('component $refs all resolve', () => {
  it('every $ref points at a defined component schema', () => {
    const schemas = schemaComponents();
    const refs = collectRefs(doc);
    expect(refs.length).toBeGreaterThan(0);
    refs.forEach((r) => {
      const match = /^#\/components\/schemas\/(.+)$/.exec(r);
      expect(match, `unexpected $ref shape: ${r}`).toBeTruthy();
      expect(schemas[match![1]], `unresolved $ref: ${r}`).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Single source — the published shapes track the runtime vocabulary
// ---------------------------------------------------------------------------

describe('single source — published shapes track the source of truth', () => {
  it('NeutralJobStatus.state enum equals the runtime JOB_STATES', () => {
    const status = schemaComponents().NeutralJobStatus;
    const variants = get(status, 'oneOf') as unknown[];
    const states = variants.map((variant) =>
      get(get(get(variant, 'properties'), 'state'), 'const')
    );
    expect(states).toEqual([...JOB_STATES]);
  });

  it('publishes the full v1 result-intent vocabulary', () => {
    const serialized = JSON.stringify(schemaComponents().ResultIntent);
    RESULT_INTENTS.forEach((intent) => {
      expect(serialized).toContain(intent);
    });
  });
});

// ---------------------------------------------------------------------------
// Neutrality invariant — no Girder route / id / enum / URL-shape leaks
// ---------------------------------------------------------------------------

const FORBIDDEN = [
  { label: 'girder route param folderId', re: /folderId/ },
  { label: 'girder api mount /api/v1', re: /\/api\/v1/ },
  { label: 'proxiable url shape', re: /proxiable/i },
  { label: 'girder mention', re: /girder/i },
  { label: 'girder folder vocabulary', re: /folder/i },
  { label: 'slicer mention', re: /slicer/i },
  { label: 'backend task xml', re: /\bxml\b/i },
  { label: 'container tech mention', re: /docker/i },
  // The girder `JobStatus` enum name — but NOT our own neutral `NeutralJobStatus`
  // component, which deliberately carries the `Neutral` prefix.
  { label: 'JobStatus enum name', re: /(?<!Neutral)JobStatus/ },
  { label: 'girder status INACTIVE', re: /\bINACTIVE\b/ },
  { label: 'girder status CANCELED', re: /\bCANCELED\b/ },
  { label: 'retired state succeeded', re: /succeeded/i },
  { label: 'retired state failed', re: /failed/i },
  { label: 'retired state queued', re: /\bqueued\b/i },
  { label: 'deletion-inventory loadedSources', re: /loadedSources/i },
  { label: 'deletion-inventory getTaskXml', re: /getTaskXml/i },
];

describe('neutrality invariant — the document leaks no backend specifics', () => {
  const serialized = JSON.stringify(doc);
  it.each(FORBIDDEN)('does not leak $label', ({ re }) => {
    expect(serialized).not.toMatch(re);
  });
});
