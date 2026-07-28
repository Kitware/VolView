import { describe, expect, it } from 'vitest';

import {
  annotationsInputFields,
  bindAnnotationsInputs,
  mintAnnotationsValue,
} from '../mintAnnotations';
import type { FormField, TaskFormModel } from '../formModel';

const modelOf = (fields: TaskFormModel['fields']): TaskFormModel => ({
  id: 'task',
  title: 'Task',
  fields,
  hidden: [],
});

const annotationsField = (
  overrides: Partial<Extract<FormField, { kind: 'sourceRef' }>> = {}
): FormField => ({
  kind: 'sourceRef',
  id: 'inputAnnotations',
  accepts: ['annotations'],
  required: true,
  ...overrides,
});

const annotationsModel = (
  overrides: Partial<Extract<FormField, { kind: 'sourceRef' }>> = {}
): TaskFormModel => modelOf([annotationsField(overrides)]);

describe('annotationsInputFields', () => {
  it('selects sourceRef params that accept annotations', () => {
    const model = modelOf([
      { kind: 'sourceRef', id: 'bg', accepts: ['image'], required: true },
      { kind: 'sourceRef', id: 'seg', accepts: ['labelmap'], required: true },
      annotationsField({ id: 'ann' }),
      { kind: 'int', id: 'radius', default: 1 },
    ]);
    expect(annotationsInputFields(model).map((f) => f.id)).toEqual(['ann']);
  });
});

describe('bindAnnotationsInputs — the binding states', () => {
  it('is a no-op when the task has no annotations input', () => {
    expect(
      bindAnnotationsInputs(
        modelOf([{ kind: 'int', id: 'n', default: 1 }]),
        true,
        true,
        true
      )
    ).toEqual({ parameters: [], states: {}, issues: [] });
  });

  it('binds the sole annotations param when tools and provenance exist', () => {
    const result = bindAnnotationsInputs(annotationsModel(), true, true, true);
    expect(result.states.inputAnnotations).toBe('bound');
    expect(result.parameters).toEqual(['inputAnnotations']);
    expect(result.issues).toEqual([]);
  });

  it('fails closed (no-annotations) so an empty file is never submitted', () => {
    const result = bindAnnotationsInputs(annotationsModel(), false, true, true);
    expect(result.states.inputAnnotations).toBe('no-annotations');
    expect(result.parameters).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].parameter).toBe('inputAnnotations');
    expect(result.issues[0].message).toMatch(
      /place a ruler, rectangle, or polygon/i
    );
  });

  it('does not block an OPTIONAL annotations input with nothing placed', () => {
    const result = bindAnnotationsInputs(
      annotationsModel({ required: false }),
      false,
      true,
      true
    );
    expect(result.states.inputAnnotations).toBe('no-annotations');
    expect(result.issues).toEqual([]);
  });

  it('fails closed (no-provenance) when the active image is local, even if optional', () => {
    const result = bindAnnotationsInputs(
      annotationsModel({ required: false }),
      true,
      false,
      true
    );
    expect(result.states.inputAnnotations).toBe('no-provenance');
    expect(result.parameters).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toMatch(/not loaded from the server/i);
  });

  it('reports the missing annotations before the missing provenance', () => {
    const result = bindAnnotationsInputs(
      annotationsModel(),
      false,
      false,
      true
    );
    expect(result.states.inputAnnotations).toBe('no-annotations');
  });

  it('fails closed (no-reference-input) when the task declares no image input', () => {
    // Adopted-job reconstruction re-identifies the parent from the persisted
    // image input; without one the results are unloadable after a reload.
    const result = bindAnnotationsInputs(annotationsModel(), true, true, false);
    expect(result.states.inputAnnotations).toBe('no-reference-input');
    expect(result.parameters).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toMatch(
      /does not declare the reference image/i
    );
  });

  it('does not block an OPTIONAL annotations input on a task without an image input', () => {
    // The defect still refuses the binding, but an optional field means the
    // task can run without annotations rather than never at all.
    const result = bindAnnotationsInputs(
      annotationsModel({ required: false }),
      true,
      true,
      false
    );
    expect(result.states.inputAnnotations).toBe('no-reference-input');
    expect(result.parameters).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('reports the task-shape defect before the scene states', () => {
    // A structural defect cannot be fixed by placing tools, so its message
    // must not be masked by no-annotations or no-provenance.
    const result = bindAnnotationsInputs(
      annotationsModel(),
      false,
      false,
      false
    );
    expect(result.states.inputAnnotations).toBe('no-reference-input');
  });

  it('fails closed (ambiguous) when more than one annotations param is present', () => {
    const result = bindAnnotationsInputs(
      modelOf([
        annotationsField({ id: 'annA' }),
        annotationsField({ id: 'annB' }),
      ]),
      true,
      true,
      true
    );
    expect(result.states.annA).toBe('ambiguous');
    expect(result.states.annB).toBe('ambiguous');
    expect(result.parameters).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toMatch(/more than one annotation input/i);
  });
});

describe('mintAnnotationsValue', () => {
  it('mints { type: "annotations", uris } from the staging response (no format)', () => {
    const uris = ['/api/v1/file/deadbeef/proxiable/scan.annotations.json'];
    expect(mintAnnotationsValue(uris)).toEqual({ type: 'annotations', uris });
  });
});
