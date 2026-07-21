import { describe, it, expect } from 'vitest';

import type { DataSource } from '@/src/io/import/dataSource';
import {
  labelmapInputFields,
  resolveLabelmapGroup,
  bindLabelmapInputs,
  mintLabelmapValue,
  mintLabelmapReferenceImage,
  labelmapStageTargets,
  type SegmentGroupView,
} from '../mintLabelmap';
import { bindImageInputs } from '../mintInput';
import type { TaskFormModel, FormField } from '../formModel';

// ---------------------------------------------------------------------------
// Fixtures — a task model with one labelmap sourceRef, plus a pure segment-group
// view built from a { groupId -> parentImage } map. Building `orderByParent`
// FROM the metadata keeps the view internally consistent, exactly like the
// store invariant (every id in `orderByParent[img]` has `parentImage === img`).
// ---------------------------------------------------------------------------

const labelmapModel = (
  overrides: Partial<Extract<FormField, { kind: 'sourceRef' }>> = {}
): TaskFormModel => ({
  id: 'task',
  title: 'Task',
  fields: [
    {
      kind: 'sourceRef',
      id: 'inputSeg',
      accepts: ['labelmap'],
      required: true,
      ...overrides,
    },
  ],
  hidden: [],
});

const viewOf = (parentByGroup: Record<string, string>): SegmentGroupView => {
  const orderByParent: Record<string, string[]> = {};
  Object.entries(parentByGroup).forEach(([groupId, parentImage]) => {
    (orderByParent[parentImage] ??= []).push(groupId);
  });
  return {
    orderByParent,
    metadataByID: Object.fromEntries(
      Object.entries(parentByGroup).map(([groupId, parentImage]) => [
        groupId,
        { parentImage },
      ])
    ),
  };
};

const localFile = (filename: string): DataSource => ({
  type: 'file',
  file: new File([], filename),
  fileType: '',
});

const remoteFile = (uri: string): DataSource => ({
  type: 'uri',
  uri,
  name: 'scan.nrrd',
});

// ---------------------------------------------------------------------------
// labelmapInputFields — binds by the open type tag off the spec, not by Slicer
// semantics.
// ---------------------------------------------------------------------------

describe('labelmapInputFields', () => {
  it('selects sourceRef params that accept a labelmap', () => {
    const model: TaskFormModel = {
      id: 'task',
      title: 'Task',
      fields: [
        { kind: 'sourceRef', id: 'bg', accepts: ['image'], required: true },
        { kind: 'sourceRef', id: 'seg', accepts: ['labelmap'], required: true },
        { kind: 'int', id: 'radius', default: 1 },
      ],
      hidden: [],
    };
    expect(labelmapInputFields(model).map((f) => f.id)).toEqual(['seg']);
  });
});

// ---------------------------------------------------------------------------
// AC — the fallback chain, all three branches (WI1).
// ---------------------------------------------------------------------------

describe('resolveLabelmapGroup — fallback chain', () => {
  it('branch 1: the paint-active group (guard passes)', () => {
    const view = viewOf({ g1: 'bg' });
    expect(resolveLabelmapGroup('bg', 'g1', view)).toEqual({
      kind: 'resolved',
      groupId: 'g1',
    });
  });

  it('branch 1 wins over multiple groups: paint-active disambiguates', () => {
    const view = viewOf({ g1: 'bg', g2: 'bg' });
    expect(resolveLabelmapGroup('bg', 'g2', view)).toEqual({
      kind: 'resolved',
      groupId: 'g2',
    });
  });

  it("branch 2: the background's ONLY segment group when none is paint-active", () => {
    const view = viewOf({ g1: 'bg' });
    expect(resolveLabelmapGroup('bg', null, view)).toEqual({
      kind: 'resolved',
      groupId: 'g1',
    });
  });

  it('branch 3: fail closed when the background has no segment group', () => {
    const view = viewOf({ gOther: 'other' });
    expect(resolveLabelmapGroup('bg', null, view)).toEqual({
      kind: 'unresolved',
    });
  });

  it('branch 3: multiple groups, none paint-active → fail closed (no v1 picker)', () => {
    const view = viewOf({ g1: 'bg', g2: 'bg' });
    expect(resolveLabelmapGroup('bg', null, view)).toEqual({
      kind: 'unresolved',
    });
  });

  it('fails closed when there is no bound background', () => {
    const view = viewOf({ g1: 'bg' });
    expect(resolveLabelmapGroup(undefined, 'g1', view)).toEqual({
      kind: 'unresolved',
    });
  });
});

// ---------------------------------------------------------------------------
// AC — the parentImage guard (WI1).
// ---------------------------------------------------------------------------

describe('resolveLabelmapGroup — parentImage guard', () => {
  it('rejects a paint-active group whose parentImage is not the background', () => {
    // g1 is paint-active but belongs to a DIFFERENT image; the background's own
    // only group (g2) is used instead (guard skips g1, chain continues).
    const view = viewOf({ g1: 'other', g2: 'bg' });
    expect(resolveLabelmapGroup('bg', 'g1', view)).toEqual({
      kind: 'resolved',
      groupId: 'g2',
    });
  });

  it('fails closed when the only paint-active group belongs to another image', () => {
    const view = viewOf({ g1: 'other' });
    expect(resolveLabelmapGroup('bg', 'g1', view)).toEqual({
      kind: 'unresolved',
    });
  });

  it('branch 2 never crosses images: an only-group on another image is not used', () => {
    const view = viewOf({ g1: 'other' });
    expect(resolveLabelmapGroup('bg', null, view)).toEqual({
      kind: 'unresolved',
    });
  });
});

// ---------------------------------------------------------------------------
// bindLabelmapInputs — states, issues, and the resolved group.
// ---------------------------------------------------------------------------

describe('bindLabelmapInputs', () => {
  it('is a no-op when the task has no labelmap input', () => {
    const model: TaskFormModel = {
      id: 'task',
      title: 'Task',
      fields: [{ kind: 'int', id: 'radius', default: 1 }],
      hidden: [],
    };
    expect(bindLabelmapInputs(model, 'bg', 'g1', viewOf({ g1: 'bg' }))).toEqual(
      {
        groups: {},
        states: {},
        issues: [],
      }
    );
  });

  it('binds the sole labelmap param to the resolved group', () => {
    const result = bindLabelmapInputs(
      labelmapModel(),
      'bg',
      'g1',
      viewOf({ g1: 'bg' })
    );
    expect(result.states.inputSeg).toBe('bound');
    expect(result.groups.inputSeg).toBe('g1');
    expect(result.issues).toHaveLength(0);
  });

  it('fails closed (no-segment-group) + refuses submit when unresolved', () => {
    const result = bindLabelmapInputs(labelmapModel(), 'bg', null, viewOf({}));
    expect(result.states.inputSeg).toBe('no-segment-group');
    expect(result.groups).toEqual({});
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].parameter).toBe('inputSeg');
    expect(result.issues[0].message).toMatch(
      /paint or select a segment group/i
    );
  });

  it('does not block an OPTIONAL labelmap input with no segment group', () => {
    // Mirrors the image binder (mintInput): an optional, unresolved labelmap
    // input stays unbound but must NOT gate submit — the task does not need it.
    const result = bindLabelmapInputs(
      labelmapModel({ required: false }),
      'bg',
      null,
      viewOf({})
    );
    expect(result.states.inputSeg).toBe('no-segment-group');
    expect(result.groups).toEqual({});
    expect(result.issues).toHaveLength(0);
  });

  it('fails closed (ambiguous) when more than one labelmap param is present', () => {
    const model: TaskFormModel = {
      id: 'task',
      title: 'Task',
      fields: [
        {
          kind: 'sourceRef',
          id: 'segA',
          accepts: ['labelmap'],
          required: true,
        },
        {
          kind: 'sourceRef',
          id: 'segB',
          accepts: ['labelmap'],
          required: true,
        },
      ],
      hidden: [],
    };
    const result = bindLabelmapInputs(model, 'bg', 'g1', viewOf({ g1: 'bg' }));
    expect(result.states.segA).toBe('ambiguous');
    expect(result.states.segB).toBe('ambiguous');
    expect(result.groups).toEqual({});
    expect(result.issues).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// WI3 — a labelmap painted on a no-provenance background is blocked "for free"
// by the SAME Chunk-8 image-binder gate; no new gate is built here.
// ---------------------------------------------------------------------------

describe('no-provenance background blocks the labelmap flow for free', () => {
  it('keeps the image no-provenance issue even when the labelmap resolves', () => {
    const model: TaskFormModel = {
      id: 'task',
      title: 'Task',
      fields: [
        { kind: 'sourceRef', id: 'bg', accepts: ['image'], required: true },
        { kind: 'sourceRef', id: 'seg', accepts: ['labelmap'], required: true },
      ],
      hidden: [],
    };

    // The background was dropped locally (no server URIs) → image binder fails
    // closed; the labelmap is perfectly resolvable on the same active image.
    const image = bindImageInputs(model, localFile('local.nrrd'));
    const labelmap = bindLabelmapInputs(
      model,
      'bg',
      'seg',
      viewOf({ seg: 'bg' })
    );

    expect(labelmap.states.seg).toBe('bound');
    expect(labelmap.issues).toHaveLength(0);

    // Submit is gated on the union of both binders' issues: the image
    // no-provenance block stands, so the resolvable labelmap cannot clear it.
    const combined = [...image.issues, ...labelmap.issues];
    expect(combined).toHaveLength(1);
    expect(combined[0].parameter).toBe('bg');
    expect(combined[0].message).toMatch(/not loaded from the server/i);
  });
});

// ---------------------------------------------------------------------------
// mintLabelmapValue / labelmapStageTargets — the value shape + stage targets.
// ---------------------------------------------------------------------------

describe('mintLabelmapValue', () => {
  it('mints { type: "labelmap", uris } from the staging response (no format)', () => {
    const uris = ['/api/v1/file/deadbeef/proxiable/seg.seg.nrrd'];
    expect(mintLabelmapValue(uris)).toEqual({ type: 'labelmap', uris });
  });
});

describe('mintLabelmapReferenceImage', () => {
  it('copies the parent image opaque provenance for a labelmap-only task', () => {
    const uri = '/api/v1/file/parent/proxiable/scan.nrrd';
    expect(
      mintLabelmapReferenceImage('g1', viewOf({ g1: 'image-a' }), (imageId) =>
        imageId === 'image-a' ? remoteFile(uri) : undefined
      )
    ).toEqual({ type: 'image', format: 'nrrd', uris: [uri] });
  });

  it('fails closed when the parent image has no server provenance', () => {
    expect(
      mintLabelmapReferenceImage('g1', viewOf({ g1: 'image-a' }), () =>
        localFile('local.nrrd')
      )
    ).toBeNull();
  });
});

describe('labelmapStageTargets', () => {
  it('lists the (paramId, groupId) pairs to serialize + stage', () => {
    const binding = bindLabelmapInputs(
      labelmapModel(),
      'bg',
      'g1',
      viewOf({ g1: 'bg' })
    );
    expect(labelmapStageTargets(binding)).toEqual([
      { parameterId: 'inputSeg', segmentGroupId: 'g1' },
    ]);
  });

  it('is empty for an unresolved binding (nothing to stage)', () => {
    const binding = bindLabelmapInputs(labelmapModel(), 'bg', null, viewOf({}));
    expect(labelmapStageTargets(binding)).toEqual([]);
  });
});
