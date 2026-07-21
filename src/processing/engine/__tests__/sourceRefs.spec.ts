import { describe, expect, it } from 'vitest';
import type { DataSource } from '@/src/io/import/dataSource';
import type { TaskFormModel } from '../formModel';
import { bindSourceRefs, type SourceRefBindingContext } from '../sourceRefs';

const remoteImage: DataSource = {
  type: 'uri',
  uri: '/data/image.nrrd',
  name: 'image.nrrd',
};

const model = (fields: TaskFormModel['fields']): TaskFormModel => ({
  id: 'task',
  title: 'Task',
  fields,
  hidden: [],
});

const context = (
  overrides: Partial<SourceRefBindingContext> = {}
): SourceRefBindingContext => ({
  activeDataSource: remoteImage,
  backgroundImageId: 'image-1',
  activeSegmentGroupId: null,
  segmentGroups: { orderByParent: {}, metadataByID: {} },
  getDataSource: () => remoteImage,
  ...overrides,
});

describe('bindSourceRefs', () => {
  it('uses an image alternative when no labelmap is available', () => {
    const bindings = bindSourceRefs(
      model([
        {
          kind: 'sourceRef',
          id: 'input',
          accepts: ['labelmap', 'image'],
          required: true,
        },
      ]),
      context()
    );

    expect(bindings.types.input).toBe('image');
    expect(bindings.image.values.input).toMatchObject({ type: 'image' });
    expect(bindings.issues).toEqual([]);
  });

  it('honors accepted-type order when both alternatives are available', () => {
    const bindings = bindSourceRefs(
      model([
        {
          kind: 'sourceRef',
          id: 'input',
          accepts: ['labelmap', 'image'],
          required: true,
        },
      ]),
      context({
        activeSegmentGroupId: 'group-1',
        segmentGroups: {
          orderByParent: { 'image-1': ['group-1'] },
          metadataByID: { 'group-1': { parentImage: 'image-1' } },
        },
      })
    );

    expect(bindings.types.input).toBe('labelmap');
    expect(bindings.labelmap.groups.input).toBe('group-1');
    expect(bindings.issues).toEqual([]);
  });

  it('uses the other type for a union alongside a dedicated input', () => {
    const bindings = bindSourceRefs(
      model([
        {
          kind: 'sourceRef',
          id: 'image',
          accepts: ['image'],
          required: true,
        },
        {
          kind: 'sourceRef',
          id: 'either',
          accepts: ['image', 'labelmap'],
          required: true,
        },
      ]),
      context({
        activeSegmentGroupId: 'group-1',
        segmentGroups: {
          orderByParent: { 'image-1': ['group-1'] },
          metadataByID: { 'group-1': { parentImage: 'image-1' } },
        },
      })
    );

    expect(bindings.types).toEqual({ image: 'image', either: 'labelmap' });
    expect(bindings.issues).toEqual([]);
  });

  it('falls back to image when a labelmap parent lacks provenance', () => {
    const bindings = bindSourceRefs(
      model([
        {
          kind: 'sourceRef',
          id: 'input',
          accepts: ['labelmap', 'image'],
          required: true,
        },
      ]),
      context({
        activeSegmentGroupId: 'group-1',
        segmentGroups: {
          orderByParent: { 'image-1': ['group-1'] },
          metadataByID: { 'group-1': { parentImage: 'image-1' } },
        },
        getDataSource: () => undefined,
      })
    );

    expect(bindings.types.input).toBe('image');
    expect(bindings.issues).toEqual([]);
  });

  it('walks image provenance only once', () => {
    let sourceReads = 0;
    const source = {
      type: 'collection',
      get sources() {
        sourceReads += 1;
        return [remoteImage];
      },
    } as DataSource;

    bindSourceRefs(
      model([
        {
          kind: 'sourceRef',
          id: 'input',
          accepts: ['image'],
          required: true,
        },
      ]),
      context({ activeDataSource: source })
    );

    // One mint reads the collection once for provenance and once for format.
    expect(sourceReads).toBe(2);
  });

  it('mints the selected labelmap reference image only once', () => {
    let dataSourceReads = 0;

    bindSourceRefs(
      model([
        {
          kind: 'sourceRef',
          id: 'input',
          accepts: ['labelmap'],
          required: true,
        },
      ]),
      context({
        activeSegmentGroupId: 'group-1',
        segmentGroups: {
          orderByParent: { 'image-1': ['group-1'] },
          metadataByID: { 'group-1': { parentImage: 'image-1' } },
        },
        getDataSource: () => {
          dataSourceReads += 1;
          return remoteImage;
        },
      })
    );

    expect(dataSourceReads).toBe(1);
  });
});
