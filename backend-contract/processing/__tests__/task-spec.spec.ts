import { describe, expect, it } from 'vitest';

import {
  SPEC_VERSION,
  taskSpecSchema,
  taskParameterSchema,
  validateTaskSpecSemantics,
  type VolViewTaskSpec,
} from '../task-spec';
import { loadFixture, loadFixtureDir } from './loadFixtures';

// ---------------------------------------------------------------------------
// Golden task-spec fixtures (positive) — every one must validate. The fixtures
// are synthetic neutral specs; the contract carries no backend-specific (e.g.
// Slicer XML) source formats — translating a native task format into this
// neutral spec is a backend concern.
// ---------------------------------------------------------------------------

describe('task-spec golden fixtures validate', () => {
  const fixtures = loadFixtureDir('task-spec');

  it('loads the expected fixtures', () => {
    expect(fixtures.map((f) => f.name).sort()).toEqual([
      'synthetic-all-kinds',
      'synthetic-bounds-enum',
    ]);
  });

  it.each(fixtures.map((f) => [f.name, f.data] as const))(
    'validates %s',
    (_name, data) => {
      expect(() => taskSpecSchema.parse(data)).not.toThrow();
    }
  );

  it('pins specVersion as an integer on every fixture', () => {
    fixtures.forEach(({ data }) => {
      const spec = taskSpecSchema.parse(data);
      expect(Number.isInteger(spec.specVersion)).toBe(true);
      expect(spec.specVersion).toBe(SPEC_VERSION);
    });
  });

  it.each(['.', '..'])('rejects the dot-segment task id %j', (id) => {
    const spec = taskSpecSchema.parse(fixtures[0].data);
    expect(taskSpecSchema.safeParse({ ...spec, id }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Field-kind coverage against the synthetic fixtures.
// ---------------------------------------------------------------------------

describe('task-spec field kinds', () => {
  const specByName = Object.fromEntries(
    loadFixtureDir('task-spec').map((f) => [
      f.name,
      taskSpecSchema.parse(f.data),
    ])
  ) as Record<string, VolViewTaskSpec>;

  const paramById = (spec: string, id: string) =>
    specByName[spec].parameters.find((p) => p.id === id);

  it('models an image sourceRef input with an open `accepts` type-tag list', () => {
    const input = paramById('synthetic-all-kinds', 'inputVolume');
    expect(input).toMatchObject({ kind: 'sourceRef', accepts: ['image'] });
    expect(input).toMatchObject({ required: true });
  });

  it('models a labelmap sourceRef input alongside the image input', () => {
    const spec = specByName['synthetic-all-kinds'];
    const background = spec.parameters.find((p) => p.id === 'inputVolume');
    const mask = spec.parameters.find((p) => p.id === 'inputLabelmap');
    expect(background).toMatchObject({ kind: 'sourceRef', accepts: ['image'] });
    expect(mask).toMatchObject({ kind: 'sourceRef', accepts: ['labelmap'] });
    expect(spec.parameters.filter((p) => p.kind === 'sourceRef')).toHaveLength(
      2
    );
  });

  it('carries numeric constraints + default on an int param', () => {
    expect(paramById('synthetic-all-kinds', 'radius')).toMatchObject({
      kind: 'int',
      min: 1,
      max: 10,
      step: 1,
      default: 1,
    });
  });

  it('models a float param with a default', () => {
    expect(paramById('synthetic-all-kinds', 'threshold')).toMatchObject({
      kind: 'float',
      default: 50,
    });
  });

  it('models bool and string params with defaults', () => {
    expect(paramById('synthetic-all-kinds', 'smooth')).toMatchObject({
      kind: 'bool',
      default: true,
    });
    expect(paramById('synthetic-all-kinds', 'label')).toMatchObject({
      kind: 'string',
      default: 'result',
    });
  });

  it('models a bounds field and an enum field with UI hints', () => {
    const roi = paramById('synthetic-bounds-enum', 'roi');
    const method = paramById('synthetic-bounds-enum', 'method');
    expect(roi).toMatchObject({
      kind: 'bounds',
      section: 'Region and options',
    });
    expect(method).toMatchObject({
      kind: 'enum',
      options: ['otsu', 'kmeans', 'manual'],
      default: 'otsu',
      order: 2,
    });
  });

  it('declares outputs with a semantic type tag', () => {
    // A single `.seg.nrrd` labelmap carries its per-label names/colors inside
    // the file as embedded metadata, so a lone `labelmap` output suffices.
    expect(
      specByName['synthetic-bounds-enum'].outputs.map((o) => o.type)
    ).toEqual(['labelmap']);
    expect(
      specByName['synthetic-all-kinds'].outputs.map((o) => o.type)
    ).toEqual(['image', 'labelmap']);
  });

  it('accepts the optional `widget` renderer-override hint', () => {
    // The renderer picks a default from `kind` when `widget` is absent; this
    // pins that the schema still accepts an explicit override.
    const parsed = taskParameterSchema.parse({
      kind: 'int',
      id: 'radius',
      title: 'Radius',
      widget: 'slider',
      min: 0,
      max: 10,
      default: 5,
    });
    expect(parsed).toMatchObject({ widget: 'slider' });
  });
});

// ---------------------------------------------------------------------------
// Negative fixtures — must FAIL validation (fail closed).
// ---------------------------------------------------------------------------

describe('task-spec negative fixtures fail validation', () => {
  it('rejects an unknown field kind', () => {
    const data = loadFixture('negative/unknown-field-kind.json');
    const result = taskSpecSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects a constraint violation (default above max)', () => {
    const data = loadFixture('negative/constraint-violation.json');
    const result = taskSpecSchema.safeParse(data);
    expect(result.success).toBe(false);
    expect(validateTaskSpecSemantics(data)).not.toHaveLength(0);
  });

  it('detects the unknown kind at the parameter level (fail-closed hide)', () => {
    // The whole spec is rejected above, but an individual param parse also
    // fails on the unknown kind — so the engine can hide that one param rather
    // than reject the whole spec.
    const badParam = { kind: 'color', id: 'tint', default: '#ff0000' };
    expect(taskParameterSchema.safeParse(badParam).success).toBe(false);
  });

  it('rejects empty and duplicate parameter ids', () => {
    const base = loadFixture('task-spec/synthetic-all-kinds.json') as Record<
      string,
      unknown
    >;
    const parameters = [
      { kind: 'string', id: 'same' },
      { kind: 'bool', id: 'same' },
      { kind: 'int', id: '' },
    ];
    const result = taskSpecSchema.safeParse({ ...base, parameters });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        ['parameters', 1, 'id'],
        ['parameters', 2, 'id'],
      ])
    );
  });

  it('rejects duplicate output ids', () => {
    const base = loadFixture('task-spec/synthetic-all-kinds.json') as Record<
      string,
      unknown
    >;
    const result = taskSpecSchema.safeParse({
      ...base,
      outputs: [{ id: 'same' }, { id: 'same' }],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['outputs', 1, 'id'] }),
      ])
    );
  });
});
