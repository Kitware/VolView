import { describe, it, expect } from 'vitest';

import type { DataSource } from '@/src/io/import/dataSource';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import {
  collectProvenanceUris,
  deriveFormat,
  mintInputValue,
  bindImageInputs,
  imageInputFields,
} from '../mintInput';
import { buildTaskFormModel, type TaskFormModel } from '../formModel';
import { parseTaskSpecEnvelope } from '../taskSpec';
import { loadFixture } from '@/backend-contract/processing/__tests__/loadFixtures';
import type { FormField } from '../formModel';

const uriSource = (uri: string): DataSource => ({
  type: 'uri',
  uri,
  name: uri.split('/').pop() ?? uri,
});

// `chunk` is never read by the mint, so a placeholder is cast in.
const dicomChunk = (uri: string): DataSource =>
  ({
    type: 'chunk',
    chunk: undefined,
    mime: FILE_EXT_TO_MIME.dcm,
    parent: uriSource(uri),
  }) as unknown as DataSource;

const dicomVolume = (uris: string[]): DataSource => ({
  type: 'collection',
  sources: uris.map(dicomChunk),
});

const localChunk = (): DataSource =>
  ({
    type: 'chunk',
    chunk: undefined,
    mime: FILE_EXT_TO_MIME.dcm,
    parent: { type: 'file', file: new File([], 'local.dcm'), fileType: '' },
  }) as unknown as DataSource;

const mixedProvenanceVolume = (uris: string[]): DataSource => ({
  type: 'collection',
  sources: [...uris.map(dicomChunk), localChunk()],
});

const remoteFile = (uri: string, filename: string): DataSource => ({
  type: 'file',
  file: new File([], filename),
  fileType: '',
  parent: uriSource(uri),
});

const localFile = (filename: string): DataSource => ({
  type: 'file',
  file: new File([], filename),
  fileType: '',
});

const archiveMember = (): DataSource => ({
  type: 'archive',
  path: 'series/1.dcm',
  parent: { type: 'file', file: new File([], 'bundle.zip'), fileType: '' },
});

const stateFileVolume = (): DataSource => ({
  type: 'file',
  file: new File([], 'restored.nrrd'),
  fileType: '',
  stateFileLeaf: { stateID: 'restored-1' },
});

const imageParamModel = (
  overrides: Partial<Extract<FormField, { kind: 'sourceRef' }>> = {}
): TaskFormModel => ({
  id: 'task',
  title: 'Task',
  fields: [
    {
      kind: 'sourceRef',
      id: 'inputVolume',
      accepts: ['image'],
      required: true,
      ...overrides,
    },
  ],
  hidden: [],
});

describe('mintInputValue matches the input-value golden fixtures', () => {
  it('mints a dicom-series image from a remote DICOM collection', () => {
    const fixture = loadFixture('wire/input-value.dicom-series.json');
    const uris = (fixture as { uris: string[] }).uris;
    const value = mintInputValue(dicomVolume(uris));
    expect(value).toEqual(fixture);
  });

  it('mints a single-file image from a remote file', () => {
    const fixture = loadFixture('wire/input-value.single-file.json') as {
      uris: string[];
    };
    const value = mintInputValue(remoteFile(fixture.uris[0], 'scan.nrrd'));
    expect(value).toEqual(fixture);
  });
});

describe('collectProvenanceUris', () => {
  it('returns the collection URIs verbatim, in slice order', () => {
    const uris = ['z/9.dcm', 'a/1.dcm', 'm/5.dcm'];
    expect(collectProvenanceUris(dicomVolume(uris))).toEqual(uris);
  });

  it('walks a file up its parent chain to the URI', () => {
    expect(
      collectProvenanceUris(remoteFile('/api/x/scan.nrrd', 'scan.nrrd'))
    ).toEqual(['/api/x/scan.nrrd']);
  });

  it('yields nothing for volumes with no URI provenance', () => {
    expect(collectProvenanceUris(localFile('local.nrrd'))).toEqual([]);
    expect(collectProvenanceUris(archiveMember())).toEqual([]);
    expect(collectProvenanceUris(stateFileVolume())).toEqual([]);
    expect(collectProvenanceUris(undefined)).toEqual([]);
  });

  it('yields nothing for a mixed-provenance collection (no partial volume)', () => {
    // Minting only the remote subset would process an incomplete volume.
    expect(
      collectProvenanceUris(mixedProvenanceVolume(['a/1.dcm', 'a/2.dcm']))
    ).toEqual([]);
  });
});

describe('deriveFormat (advisory)', () => {
  it('labels a DICOM collection dicom-series', () => {
    expect(deriveFormat(dicomVolume(['a/1.dcm']))).toBe('dicom-series');
  });

  it('uses the trailing extension for a single file', () => {
    expect(deriveFormat(remoteFile('/api/x/scan.nrrd', 'scan.nrrd'))).toBe(
      'nrrd'
    );
  });
});

describe('mintInputValue fails closed for no-provenance volumes', () => {
  it.each([
    ['local file drop', localFile('local.nrrd')],
    ['archive member', archiveMember()],
    ['restored state file', stateFileVolume()],
    ['mixed remote/local collection', mixedProvenanceVolume(['a/1.dcm'])],
  ])('returns null for a %s', (_label, ds) => {
    expect(mintInputValue(ds)).toBeNull();
  });
});

describe('bindImageInputs auto-binds the active dataset', () => {
  it('binds the sole image param to the active volume', () => {
    const result = bindImageInputs(
      imageParamModel(),
      remoteFile('/api/x/scan.nrrd', 'scan.nrrd')
    );
    expect(result.states.inputVolume).toBe('bound');
    expect(result.issues).toHaveLength(0);
    expect(result.values.inputVolume).toEqual({
      type: 'image',
      format: 'nrrd',
      uris: ['/api/x/scan.nrrd'],
    });
  });

  it('fails closed (no-provenance) + refuses submit for a local-drop volume', () => {
    const result = bindImageInputs(imageParamModel(), localFile('local.nrrd'));
    expect(result.states.inputVolume).toBe('no-provenance');
    expect(result.values.inputVolume).toBeNull();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].parameter).toBe('inputVolume');
    expect(result.issues[0].message).toMatch(/not loaded from the server/i);
  });

  it('fails closed (no-provenance) for a mixed remote/local collection', () => {
    const result = bindImageInputs(
      imageParamModel(),
      mixedProvenanceVolume(['a/1.dcm', 'a/2.dcm'])
    );
    expect(result.states.inputVolume).toBe('no-provenance');
    expect(result.values.inputVolume).toBeNull();
    expect(result.issues).toHaveLength(1);
  });

  it('fails closed (ambiguous) when more than one image param is present', () => {
    const model: TaskFormModel = {
      id: 'task',
      title: 'Task',
      fields: [
        { kind: 'sourceRef', id: 'ct', accepts: ['image'], required: true },
        { kind: 'sourceRef', id: 'pet', accepts: ['image'], required: true },
      ],
      hidden: [],
    };
    const result = bindImageInputs(
      model,
      remoteFile('/api/x/scan.nrrd', 'scan.nrrd')
    );
    expect(result.states.ct).toBe('ambiguous');
    expect(result.states.pet).toBe('ambiguous');
    expect(result.values).toEqual({ ct: null, pet: null });
    expect(result.issues).toHaveLength(1);
  });

  it('is a no-op when the task has no image input', () => {
    const model: TaskFormModel = {
      id: 'task',
      title: 'Task',
      fields: [{ kind: 'int', id: 'radius', default: 1 }],
      hidden: [],
    };
    expect(
      bindImageInputs(model, remoteFile('/api/x/scan.nrrd', 'scan.nrrd'))
    ).toEqual({
      values: {},
      states: {},
      issues: [],
    });
  });

  it('refuses submit for a required image input with no active dataset', () => {
    const result = bindImageInputs(imageParamModel(), undefined);
    expect(result.states.inputVolume).toBe('unbound');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toMatch(/required/i);
  });

  it('does not block an OPTIONAL image input with no active dataset', () => {
    const result = bindImageInputs(
      imageParamModel({ required: false }),
      undefined
    );
    expect(result.states.inputVolume).toBe('unbound');
    expect(result.issues).toHaveLength(0);
  });
});

describe('bindImageInputs over a real task-spec fixture', () => {
  it('finds and binds the image inputVolume from provenance', () => {
    const model = buildTaskFormModel(
      parseTaskSpecEnvelope(loadFixture('task-spec/synthetic-all-kinds.json'))
    );
    expect(imageInputFields(model).map((f) => f.id)).toEqual(['inputVolume']);

    const uris = (
      loadFixture('wire/input-value.dicom-series.json') as { uris: string[] }
    ).uris;
    const result = bindImageInputs(model, dicomVolume(uris));
    expect(result.states.inputVolume).toBe('bound');
    expect(result.values.inputVolume).toEqual({
      type: 'image',
      format: 'dicom-series',
      uris,
    });
  });
});
