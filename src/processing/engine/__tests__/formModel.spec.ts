import { describe, it, expect } from 'vitest';

import { parseTaskSpecEnvelope } from '../taskSpec';
import {
  buildTaskFormModel,
  initialFormValues,
  validateFormValues,
} from '../formModel';
import {
  loadFixture,
  loadFixtureDir,
} from '@/backend-contract/processing/__tests__/loadFixtures';

const KNOWN_KINDS = [
  'int',
  'float',
  'string',
  'bool',
  'enum',
  'sourceRef',
  'bounds',
];

describe('form model renders every golden task-spec fixture', () => {
  const fixtures = loadFixtureDir('task-spec');

  it('loads the golden fixtures', () => {
    expect(fixtures.map((f) => f.name).sort()).toEqual([
      'synthetic-all-kinds',
      'synthetic-bounds-enum',
    ]);
  });

  it.each(fixtures.map((f) => [f.name, f.data] as const))(
    'builds a fully renderable model for %s (nothing hidden)',
    (_name, data) => {
      const model = buildTaskFormModel(parseTaskSpecEnvelope(data));
      expect(model.hidden).toHaveLength(0);
      expect(model.fields.length).toBeGreaterThan(0);
      model.fields.forEach((f) => expect(KNOWN_KINDS).toContain(f.kind));
    }
  );

  it('renders the sourceRef + bounds + enum fields of the synthetic fixture, order-sorted', () => {
    const model = buildTaskFormModel(
      parseTaskSpecEnvelope(loadFixture('task-spec/synthetic-bounds-enum.json'))
    );
    const kinds = model.fields.map((f) => f.kind);
    expect(kinds).toContain('sourceRef');
    expect(kinds).toContain('bounds');
    expect(kinds).toContain('enum');
    expect(model.fields.map((f) => f.id)).toEqual([
      'inputVolume',
      'roi',
      'method',
      'iterations',
    ]);
  });

  it('seeds initial values from typed spec defaults; leaves sourceRef unbound', () => {
    const model = buildTaskFormModel(
      parseTaskSpecEnvelope(loadFixture('task-spec/synthetic-all-kinds.json'))
    );
    const values = initialFormValues(model);
    expect(values.radius).toBe(1);
    expect(values.inputVolume).toBeNull();
  });

  it('seeds an enum default (and falls back to the first option)', () => {
    const model = buildTaskFormModel(
      parseTaskSpecEnvelope(loadFixture('task-spec/synthetic-bounds-enum.json'))
    );
    expect(initialFormValues(model).method).toBe('otsu');
  });

  it('seeds a NUMERIC enum default with its number type intact', () => {
    const model = buildTaskFormModel(
      parseTaskSpecEnvelope(loadFixture('task-spec/synthetic-bounds-enum.json'))
    );
    // Stringifying the default would submit a type the CLI rejects.
    expect(initialFormValues(model).iterations).toBe(2);
  });
});

describe('fail closed on an unknown or invalid parameter', () => {
  it('hides an unknown field kind but keeps the valid params (negative fixture)', () => {
    const model = buildTaskFormModel(
      parseTaskSpecEnvelope(loadFixture('negative/unknown-field-kind.json'))
    );
    expect(model.hidden.map((h) => h.id)).toEqual(['tint']);
    expect(model.fields.map((f) => f.id)).toEqual(['inputVolume']);
  });

  it('still allows submit when the hidden param was NOT required', () => {
    const model = buildTaskFormModel(
      parseTaskSpecEnvelope(loadFixture('negative/unknown-field-kind.json'))
    );
    const issues = validateFormValues(model, { inputVolume: 'uri:1' });
    expect(issues.some((i) => i.parameter === 'tint')).toBe(false);
    expect(issues).toHaveLength(0);
  });

  it('refuses submit when a REQUIRED param had to be hidden', () => {
    const model = buildTaskFormModel(
      parseTaskSpecEnvelope({
        specVersion: 1,
        id: 'x',
        title: 'X',
        parameters: [{ kind: 'color', id: 'tint', required: true }],
        outputs: [],
      })
    );
    expect(model.fields).toHaveLength(0);
    expect(model.hidden).toEqual([
      { id: 'tint', required: true, reason: expect.any(String) },
    ]);
    const issues = validateFormValues(model, {});
    expect(issues.map((i) => i.parameter)).toContain('tint');
  });

  it('hides a param whose constraints are self-inconsistent (default above max)', () => {
    const model = buildTaskFormModel(
      parseTaskSpecEnvelope(loadFixture('negative/constraint-violation.json'))
    );
    expect(model.hidden.map((h) => h.id)).toEqual(['radius']);
    expect(model.fields.map((f) => f.id)).toEqual(['inputVolume']);
  });
});

describe('value validation gates submit', () => {
  const model = () =>
    buildTaskFormModel(
      parseTaskSpecEnvelope(loadFixture('task-spec/synthetic-all-kinds.json'))
    );

  it('flags an unbound required input', () => {
    const issues = validateFormValues(model(), {
      inputVolume: null,
      radius: 1,
    });
    expect(issues.some((i) => i.parameter === 'inputVolume')).toBe(true);
  });

  it('enforces numeric max', () => {
    const issues = validateFormValues(model(), {
      inputVolume: 'uri:1',
      radius: 99,
    });
    expect(issues.some((i) => i.parameter === 'radius')).toBe(true);
  });

  it('passes a fully valid value set', () => {
    const issues = validateFormValues(model(), {
      inputVolume: 'uri:1',
      radius: 5,
    });
    expect(issues).toHaveLength(0);
  });

  it('accepts a required enum whose selected member is the empty string', () => {
    // Enum membership includes '', so treating it as unfilled would block submit.
    const enumModel = buildTaskFormModel(
      parseTaskSpecEnvelope({
        specVersion: 1,
        id: 'x',
        title: 'X',
        parameters: [
          { kind: 'enum', id: 'mode', required: true, options: ['', 'fast'] },
        ],
        outputs: [],
      })
    );
    expect(validateFormValues(enumModel, { mode: '' })).toHaveLength(0);
    expect(
      validateFormValues(enumModel, { mode: null }).map((i) => i.parameter)
    ).toContain('mode');
  });
});
