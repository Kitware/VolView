import { describe, it, expect } from 'vitest';

import type { DataSource } from '@/src/io/import/dataSource';
import {
  labelmapInputFields,
  resolveLabelmapGroups,
  mintLabelmapValue,
  mintLabelmapReferenceImage,
  type SegmentGroupView,
} from '../mintLabelmap';
import { bindSourceRefs, type SourceRefBindingContext } from '../sourceRefs';
import type { TaskFormModel, FormField } from '../formModel';
import { createSourceRefBindingContext } from './sourceRefBindingContext';

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

const context = (
  overrides: Partial<SourceRefBindingContext> = {}
): SourceRefBindingContext =>
  createSourceRefBindingContext({
    activeDataSource: remoteFile('/api/x/scan.nrrd'),
    backgroundImageId: 'bg',
    segmentGroups: viewOf({}),
    getDataSource: () => remoteFile('/api/x/scan.nrrd'),
    ...overrides,
  });

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

describe('resolveLabelmapGroups', () => {
  it('returns the sole base image group for a singular parameter', () => {
    const view = viewOf({ g1: 'bg' });
    expect(resolveLabelmapGroups('bg', null, false, view)).toEqual({
      kind: 'resolved',
      groupIds: ['g1'],
    });
  });

  it('returns the selected group for a singular parameter', () => {
    const view = viewOf({ g1: 'bg', g2: 'bg' });
    expect(resolveLabelmapGroups('bg', 'g2', false, view)).toEqual({
      kind: 'resolved',
      groupIds: ['g2'],
    });
  });

  it('returns every base image group for a multiple parameter', () => {
    const view = viewOf({ g1: 'bg', g2: 'bg' });
    expect(resolveLabelmapGroups('bg', 'g2', true, view)).toEqual({
      kind: 'resolved',
      groupIds: ['g1', 'g2'],
    });
  });

  it('fails closed for a singular parameter with ambiguous unselected groups', () => {
    const view = viewOf({ g1: 'bg', g2: 'bg' });
    expect(resolveLabelmapGroups('bg', null, false, view)).toEqual({
      kind: 'unresolved',
    });
  });

  it('fails closed when the background has no segment group', () => {
    const view = viewOf({ gOther: 'other' });
    expect(resolveLabelmapGroups('bg', null, true, view)).toEqual({
      kind: 'unresolved',
    });
  });

  it('fails closed when there is no bound background', () => {
    const view = viewOf({ g1: 'bg' });
    expect(resolveLabelmapGroups(undefined, 'g1', true, view)).toEqual({
      kind: 'unresolved',
    });
  });
});

describe('resolveLabelmapGroups — parentImage guard', () => {
  it('does not include groups belonging to another image', () => {
    const view = viewOf({ g1: 'other', g2: 'bg' });
    expect(resolveLabelmapGroups('bg', null, true, view)).toEqual({
      kind: 'resolved',
      groupIds: ['g2'],
    });
  });

  it('fails closed when the only group belongs to another image', () => {
    const view = viewOf({ g1: 'other' });
    expect(resolveLabelmapGroups('bg', null, true, view)).toEqual({
      kind: 'unresolved',
    });
  });
});

describe('labelmap binding through bindSourceRefs', () => {
  it('is a no-op when the task has no labelmap input', () => {
    const model: TaskFormModel = {
      id: 'task',
      title: 'Task',
      fields: [{ kind: 'int', id: 'radius', default: 1 }],
      hidden: [],
    };
    const bindings = bindSourceRefs(
      model,
      context({ segmentGroups: viewOf({ g1: 'bg' }) })
    );
    expect(bindings.labelmap).toEqual({
      groups: {},
      states: {},
      issues: [],
    });
  });

  it('fails closed (no-segment-group) + refuses submit when unresolved', () => {
    const bindings = bindSourceRefs(labelmapModel(), context());
    expect(bindings.states.inputSeg).toBe('no-segment-group');
    expect(bindings.labelmap.groups).toEqual({});
    expect(bindings.issues).toHaveLength(1);
    expect(bindings.issues[0].parameter).toBe('inputSeg');
    expect(bindings.issues[0].message).toMatch(
      /paint or select a segment group/i
    );
  });

  it('fails closed for a REQUIRED multiple labelmap input with no group', () => {
    const bindings = bindSourceRefs(
      labelmapModel({ multiple: true }),
      context()
    );
    expect(bindings.states.inputSeg).toBe('no-segment-group');
    expect(bindings.labelmap.groups).toEqual({});
    expect(bindings.issues).toHaveLength(1);
    // Selecting a group is no remedy for a param that takes all of them.
    expect(bindings.issues[0].message).toBe(
      'Paint a segment group on the active dataset first.'
    );
  });

  it('does not block an OPTIONAL labelmap input with no segment group', () => {
    const bindings = bindSourceRefs(
      labelmapModel({ required: false }),
      context()
    );
    expect(bindings.states.inputSeg).toBe('no-segment-group');
    expect(bindings.labelmap.groups).toEqual({});
    expect(bindings.issues).toHaveLength(0);
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
    const bindings = bindSourceRefs(
      model,
      context({
        activeSegmentGroupId: 'g1',
        segmentGroups: viewOf({ g1: 'bg' }),
      })
    );
    expect(bindings.states.segA).toBe('ambiguous');
    expect(bindings.states.segB).toBe('ambiguous');
    expect(bindings.labelmap.groups).toEqual({});
    expect(bindings.issues).toHaveLength(1);
  });
});

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

    const bindings = bindSourceRefs(
      model,
      context({
        activeDataSource: localFile('local.nrrd'),
        segmentGroups: viewOf({ seg: 'bg' }),
      })
    );

    expect(bindings.states.seg).toBe('bound');
    expect(bindings.issues).toHaveLength(1);
    expect(bindings.issues[0].parameter).toBe('bg');
    expect(bindings.issues[0].message).toMatch(/not loaded from the server/i);
  });
});

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
