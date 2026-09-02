import { describe, expect, it } from 'vitest';

import { hits, isTest, sourceFiles } from './sourceAudit';

// Phase 1 exit audit: no tool infers segment identity from a label value and no
// segment-group identity surface survives. Encodes the plan's exit greps so the
// unit suite, not a human grep, guards the boundary.

// Legacy manifests still name the old fields on the wire; the migration and the
// fixtures that feed it are the only places allowed to say so.
const LEGACY_ALLOWED = (rel: string) =>
  rel === 'src/io/state-file/migrations.ts' || isTest(rel);

describe('segment model exit audit', () => {
  const srcFiles = sourceFiles(import.meta.url, 'src');
  const identityFiles = srcFiles.filter((rel) => !LEGACY_ALLOWED(rel));

  it('has no activeSegmentGroupID outside the legacy migration', () => {
    expect(hits(identityFiles, /activeSegmentGroupID/)).toEqual([]);
  });

  it('has no paint store active segment label value', () => {
    expect(hits(identityFiles, /paintStore\.activeSegment\b/)).toEqual([]);
  });

  it('has no SegmentMask identifier outside the legacy migration', () => {
    expect(hits(identityFiles, /SegmentMask/)).toEqual([]);
  });

  it('introduces no skipped specs', () => {
    const skipped = hits(
      sourceFiles(import.meta.url, 'src', 'tests'),
      /\b(describe|it|test)\.skip\b/
    ).map((hit) => hit.split(':')[0]);
    // Pre-existing on main, untouched by this work.
    expect([...new Set(skipped)]).toEqual([
      'src/core/thumbnailers/__tests__/vtk-image.spec.ts',
    ]);
  });
});
