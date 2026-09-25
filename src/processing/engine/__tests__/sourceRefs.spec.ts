import { describe, expect, it } from 'vitest';
import type { DataSource } from '@/src/io/import/dataSource';
import type { TaskFormModel } from '../formModel';
import type { SourceRefField } from '../mintInput';
import { bindSourceRefs, type SourceRefBindingContext } from '../sourceRefs';
import { createSourceRefBindingContext } from './sourceRefBindingContext';

const remoteImage: DataSource = {
  type: 'uri',
  uri: '/data/image.nrrd',
  name: 'image.nrrd',
};

const inputField = (
  id: string,
  accepts: string[],
  overrides: Partial<SourceRefField> = {}
): SourceRefField => ({
  kind: 'sourceRef',
  id,
  accepts,
  required: true,
  ...overrides,
});

const model = (fields: TaskFormModel['fields']): TaskFormModel => ({
  id: 'task',
  title: 'Task',
  fields,
  hidden: [],
});

const context = (
  overrides: Partial<SourceRefBindingContext> = {}
): SourceRefBindingContext =>
  createSourceRefBindingContext({
    activeDataSource: remoteImage,
    ...overrides,
  });

const oneSegmentation = {
  segmentation: { id: 'segmentation-1', parentImageId: 'image-1' },
};

describe('bindSourceRefs', () => {
  it('uses an image alternative when no labelmap is available', () => {
    const bindings = bindSourceRefs(
      model([inputField('input', ['labelmap', 'image'])]),
      context()
    );

    expect(bindings.types.input).toBe('image');
    expect(bindings.image.values.input).toMatchObject({ type: 'image' });
    expect(bindings.issues).toEqual([]);
  });

  it('binds the segmentation when a multiple labelmap is accepted', () => {
    const bindings = bindSourceRefs(
      model([inputField('input', ['labelmap', 'image'], { multiple: true })]),
      context({
        segmentation: { id: 'segmentation-1', parentImageId: 'image-1' },
      })
    );

    expect(bindings.types.input).toBe('labelmap');
    expect(bindings.labelmap.segmentations.input).toEqual('segmentation-1');
    expect(bindings.issues).toEqual([]);
  });

  it('keeps the segmentation binding when a union sibling takes the image', () => {
    const bindings = bindSourceRefs(
      model([
        inputField('segs', ['labelmap'], { multiple: true }),
        inputField('either', ['image', 'labelmap']),
      ]),
      context({
        segmentation: { id: 'segmentation-1', parentImageId: 'image-1' },
      })
    );

    expect(bindings.types).toEqual({ segs: 'labelmap', either: 'image' });
    expect(bindings.labelmap.segmentations.segs).toEqual('segmentation-1');
    expect(bindings.states.segs).toBe('bound');
    expect(bindings.issues).toEqual([]);
  });

  it('binds the segmentation for a singular labelmap', () => {
    const bindings = bindSourceRefs(
      model([inputField('input', ['labelmap'])]),
      context({
        segmentation: { id: 'segmentation-1', parentImageId: 'image-1' },
      })
    );

    expect(bindings.labelmap.segmentations.input).toEqual('segmentation-1');
    expect(bindings.issues).toEqual([]);
  });

  it('uses the other type for a union alongside a dedicated input', () => {
    const bindings = bindSourceRefs(
      model([
        inputField('image', ['image']),
        inputField('either', ['image', 'labelmap']),
      ]),
      context({
        segmentation: { id: 'segmentation-1', parentImageId: 'image-1' },
      })
    );

    expect(bindings.types).toEqual({ image: 'image', either: 'labelmap' });
    expect(bindings.issues).toEqual([]);
  });

  it('refuses a labelmap whose parent image lacks provenance', () => {
    const bindings = bindSourceRefs(
      model([inputField('segs', ['labelmap'], { multiple: true })]),
      context({ ...oneSegmentation, activeDataSource: undefined })
    );
    expect(bindings.states.segs).toBe('no-provenance');
    expect(bindings.issues).toHaveLength(1);
    expect(bindings.issues[0].message).toMatch(/not loaded from the server/i);
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
      model([inputField('input', ['image'])]),
      context({ activeDataSource: source })
    );

    // One mint reads the collection once for provenance and once for format.
    expect(sourceReads).toBe(2);
  });
});

describe('bindSourceRefs — annotations', () => {
  // The RulerToRectangle shape: the reference image is declared alongside the
  // annotations, which is what makes results reloadable in a later session.
  const annotationsModel = () =>
    model([
      { kind: 'sourceRef', id: 'image', accepts: ['image'], required: true },
      inputField('annotations', ['annotations']),
    ]);

  const annotationsOnlyModel = () =>
    model([inputField('annotations', ['annotations'])]);

  it('binds a dedicated annotations input when tools exist on a remote image', () => {
    const bindings = bindSourceRefs(
      annotationsModel(),
      context({ hasFinishedAnnotations: true })
    );

    expect(bindings.types.annotations).toBe('annotations');
    expect(bindings.annotations.parameters).toEqual(['annotations']);
    expect(bindings.states.annotations).toBe('bound');
    expect(bindings.issues).toEqual([]);
  });

  it('fails closed with nothing placed', () => {
    const bindings = bindSourceRefs(annotationsModel(), context());

    expect(bindings.annotations.parameters).toEqual([]);
    expect(bindings.states.annotations).toBe('no-annotations');
    expect(bindings.issues).toHaveLength(1);
    expect(bindings.issues[0].message).toMatch(/place a ruler/i);
  });

  it('fails closed when the annotated image has no server provenance', () => {
    const bindings = bindSourceRefs(
      annotationsModel(),
      context({
        hasFinishedAnnotations: true,
        activeDataSource: {
          type: 'file',
          file: new File([], 'local.nrrd'),
          fileType: '',
        },
      })
    );

    expect(bindings.annotations.parameters).toEqual([]);
    expect(bindings.states.annotations).toBe('no-provenance');
    // Both the image input and the annotations input report the missing
    // provenance.
    expect(bindings.issues).toHaveLength(2);
  });

  it('fails closed when the task declares no reference image input', () => {
    // Adopted-job reconstruction re-identifies the parent from the persisted
    // image input, so an annotations-only task would produce results no later
    // session could load. Blocks even with tools placed and provenance intact.
    const bindings = bindSourceRefs(
      annotationsOnlyModel(),
      context({ hasFinishedAnnotations: true })
    );

    expect(bindings.annotations.parameters).toEqual([]);
    expect(bindings.states.annotations).toBe('no-reference-input');
    expect(bindings.issues).toHaveLength(1);
    expect(bindings.issues[0].message).toMatch(
      /does not declare the reference image/i
    );
  });

  it('a staged-type sibling does not count as the reference image', () => {
    // Labelmap inputs are excluded from parent reconstruction just like
    // annotations, so a labelmap sibling leaves the task unloadable too.
    const bindings = bindSourceRefs(
      model([
        { kind: 'sourceRef', id: 'seg', accepts: ['labelmap'], required: true },
        inputField('annotations', ['annotations']),
      ]),
      context({ hasFinishedAnnotations: true, ...oneSegmentation })
    );

    expect(bindings.annotations.parameters).toEqual([]);
    expect(bindings.states.annotations).toBe('no-reference-input');
  });

  it('binds an image and an annotations input from the same active image', () => {
    const bindings = bindSourceRefs(
      model([
        { kind: 'sourceRef', id: 'image', accepts: ['image'], required: true },
        inputField('annotations', ['annotations']),
      ]),
      context({ hasFinishedAnnotations: true })
    );

    expect(bindings.types).toEqual({
      image: 'image',
      annotations: 'annotations',
    });
    expect(bindings.image.values.image).toMatchObject({ type: 'image' });
    expect(bindings.annotations.parameters).toEqual(['annotations']);
    expect(bindings.issues).toEqual([]);
  });

  it('prefers an available annotations alternative over a dedicated image', () => {
    const bindings = bindSourceRefs(
      model([
        { kind: 'sourceRef', id: 'image', accepts: ['image'], required: true },
        inputField('either', ['image', 'annotations']),
      ]),
      context({ hasFinishedAnnotations: true })
    );

    expect(bindings.types).toEqual({
      image: 'image',
      either: 'annotations',
    });
    expect(bindings.annotations.parameters).toEqual(['either']);
    expect(bindings.issues).toEqual([]);
  });

  it('falls back to the image alternative when nothing is placed', () => {
    const bindings = bindSourceRefs(
      model([inputField('either', ['annotations', 'image'])]),
      context()
    );

    expect(bindings.types.either).toBe('image');
    expect(bindings.annotations.parameters).toEqual([]);
    expect(bindings.issues).toEqual([]);
  });

  it('binds all three kinds side by side', () => {
    const bindings = bindSourceRefs(
      model([
        { kind: 'sourceRef', id: 'image', accepts: ['image'], required: true },
        { kind: 'sourceRef', id: 'seg', accepts: ['labelmap'], required: true },
        inputField('annotations', ['annotations']),
      ]),
      context({ hasFinishedAnnotations: true, ...oneSegmentation })
    );

    expect(bindings.types).toEqual({
      image: 'image',
      seg: 'labelmap',
      annotations: 'annotations',
    });
    expect(bindings.labelmap.segmentations.seg).toEqual('segmentation-1');
    expect(bindings.annotations.parameters).toEqual(['annotations']);
    expect(bindings.issues).toEqual([]);
  });

  it('mints the active image once for an image + annotations task', () => {
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
        { kind: 'sourceRef', id: 'image', accepts: ['image'], required: true },
        inputField('annotations', ['annotations']),
      ]),
      context({ activeDataSource: source, hasFinishedAnnotations: true })
    );

    // One mint reads the collection once for provenance and once for format.
    expect(sourceReads).toBe(2);
  });
});
