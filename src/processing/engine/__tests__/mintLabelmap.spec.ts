import { describe, it, expect } from 'vitest';

import type { DataSource } from '@/src/io/import/dataSource';
import { labelmapInputFields, mintLabelmapValue } from '../mintLabelmap';
import { bindSourceRefs } from '../sourceRefs';
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

const localFile = (filename: string): DataSource => ({
  type: 'file',
  file: new File([], filename),
  fileType: '',
});

const context = createSourceRefBindingContext;

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

describe('labelmap binding through bindSourceRefs', () => {
  it('is a no-op when the task has no labelmap input', () => {
    const model: TaskFormModel = {
      id: 'task',
      title: 'Task',
      fields: [{ kind: 'int', id: 'radius', default: 1 }],
      hidden: [],
    };
    const bindings = bindSourceRefs(model, context({ segmentationId: 'g1' }));
    expect(bindings.labelmap).toEqual({
      segmentations: {},
      states: {},
      issues: [],
    });
  });

  it('fails closed (no-segmentation) + refuses submit when unresolved', () => {
    const bindings = bindSourceRefs(labelmapModel(), context());
    expect(bindings.states.inputSeg).toBe('no-segmentation');
    expect(bindings.labelmap.segmentations).toEqual({});
    expect(bindings.issues).toHaveLength(1);
    expect(bindings.issues[0].parameter).toBe('inputSeg');
    expect(bindings.issues[0].message).toMatch(/paint a segment/i);
  });

  it('fails closed for a REQUIRED multiple labelmap input with no segmentation', () => {
    const bindings = bindSourceRefs(
      labelmapModel({ multiple: true }),
      context()
    );
    expect(bindings.states.inputSeg).toBe('no-segmentation');
    expect(bindings.labelmap.segmentations).toEqual({});
    expect(bindings.issues).toHaveLength(1);
    expect(bindings.issues[0].message).toBe(
      'Paint a segment on the current image first.'
    );
  });

  it('does not block an OPTIONAL labelmap input with no segmentation', () => {
    const bindings = bindSourceRefs(
      labelmapModel({ required: false }),
      context()
    );
    expect(bindings.states.inputSeg).toBe('no-segmentation');
    expect(bindings.labelmap.segmentations).toEqual({});
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
        segmentationId: 'g1',
      })
    );
    expect(bindings.states.segA).toBe('ambiguous');
    expect(bindings.states.segB).toBe('ambiguous');
    expect(bindings.labelmap.segmentations).toEqual({});
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
        segmentationId: 'seg',
      })
    );

    expect(bindings.states.seg).toBe('no-provenance');
    expect(bindings.issues).toHaveLength(2);
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
