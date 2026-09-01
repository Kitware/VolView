import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setActivePinia, createPinia } from 'pinia';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';

// Phase 1 exit audit: no tool infers segment identity from a label value and no
// segment-group identity surface survives. Encodes the plan's exit greps so the
// unit suite, not a human grep, guards the boundary.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

const SELF = 'src/__tests__/segmentIdentityAudit.spec.ts';
const SEGMENT_GROUPS_MODULE = 'src/store/segmentGroups.ts';

const SOURCE_EXTENSIONS = ['.ts', '.js', '.vue'];
const SKIPPED_DIRS = new Set(['node_modules', 'emscripten-build', 'dist']);

// Legacy manifests still name the old fields on the wire; the migration and the
// fixtures that feed it are the only places allowed to say so.
const LEGACY_ALLOWED = (rel: string) =>
  rel === 'src/io/state-file/migrations.ts' ||
  rel.split(path.sep).includes('__tests__');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : walk(full);
    }
    return SOURCE_EXTENSIONS.includes(path.extname(entry.name)) ? [full] : [];
  });
}

function sourceFiles(...dirs: string[]) {
  return dirs
    .flatMap((dir) => walk(path.resolve(repoRoot, dir)))
    .map((full) => path.relative(repoRoot, full))
    .filter((rel) => rel !== SELF);
}

const read = (rel: string) =>
  fs.readFileSync(path.resolve(repoRoot, rel), 'utf-8');

function hits(files: string[], pattern: RegExp) {
  return files.flatMap((rel) =>
    read(rel)
      .split('\n')
      .flatMap((line, index) =>
        pattern.test(line) ? [`${rel}:${index + 1}`] : []
      )
  );
}

describe('segment model exit audit', () => {
  const srcFiles = sourceFiles('src');
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
      sourceFiles('src', 'tests'),
      /\b(describe|it|test)\.skip\b/
    ).map((hit) => hit.split(':')[0]);
    // Pre-existing on main, untouched by this work.
    expect([...new Set(skipped)]).toEqual([
      'src/core/thumbnailers/__tests__/vtk-image.spec.ts',
    ]);
  });
});

const STORE_FACTORY = 'useSegmentGroupStore';

const escapeRegExp = (value: string) => value.replace(/[$]/g, '\\$&');

const names = (list: string) =>
  list
    .split(',')
    .map((part) =>
      part
        .replace(/^\s*type\s+/, '')
        .split(/\s+as\s+/)
        .pop()!
        .trim()
    )
    .filter(Boolean);

// A member kept alive only by its own spec is still dead surface, so tests do
// not count as consumers.
const productionConsumers = sourceFiles('src').filter(
  (rel) =>
    rel !== SEGMENT_GROUPS_MODULE && !rel.split(path.sep).includes('__tests__')
);

// Identifiers bound to the segment group store in a file, so a member read is
// attributed to the store instead of to any same-named symbol.
function storeReceivers(text: string) {
  const receivers = [`${STORE_FACTORY}\\(\\)`];
  for (let pass = 0; pass < 2; pass += 1) {
    receivers.push(
      ...receivers.flatMap((receiver) =>
        [
          ...text.matchAll(
            new RegExp(
              `(?:const|let|var)\\s+([A-Za-z0-9_$]+)\\s*=\\s*(?:storeToRefs\\(|toRefs\\()?\\s*${receiver}`,
              'g'
            )
          ),
        ].map((match) => escapeRegExp(match[1]))
      )
    );
  }
  return [...new Set(receivers)];
}

function membersReadFrom(text: string) {
  if (!text.includes(STORE_FACTORY)) return [];
  const receivers = storeReceivers(text);
  return receivers.flatMap((receiver) => [
    ...[
      ...text.matchAll(
        new RegExp(`\\b${receiver}\\s*\\??\\.\\s*([A-Za-z0-9_$]+)`, 'g')
      ),
    ].map((match) => match[1]),
    ...[
      ...text.matchAll(
        new RegExp(
          `(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*(?:storeToRefs\\(|toRefs\\()?\\s*\\b${receiver}`,
          'g'
        )
      ),
    ].flatMap((match) => names(match[1])),
  ]);
}

describe('segment group module surface', () => {
  const importedFromModule = new Set(
    productionConsumers.flatMap((rel) =>
      [
        ...read(rel).matchAll(
          /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'[^']*store\/segmentGroups'/g
        ),
      ].flatMap((match) => names(match[1]))
    )
  );

  const readMembers = new Set(
    productionConsumers.flatMap((rel) => membersReadFrom(read(rel)))
  );

  it('exports nothing that no consumer imports', () => {
    const exported = [
      ...read(SEGMENT_GROUPS_MODULE).matchAll(
        /^export\s+(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm
      ),
    ].map((match) => match[1]);

    expect(exported.length).toBeGreaterThan(0);
    expect(exported.filter((name) => !importedFromModule.has(name))).toEqual(
      []
    );
  });

  it('exposes no store action that no consumer calls', () => {
    setActivePinia(createPinia());
    const store = useSegmentGroupStore();
    const api = Object.keys(store).filter(
      (key) => !key.startsWith('_') && !key.startsWith('$')
    );

    expect(api.length).toBeGreaterThan(0);
    expect(api.filter((name) => !readMembers.has(name))).toEqual([]);
  });
});
