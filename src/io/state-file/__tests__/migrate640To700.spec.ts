import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import JSZip from 'jszip';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';
import { leafStateId } from '@/src/io/import/dataSource';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { DEFAULT_SEGMENTATION_FILL_OPACITY } from '@/src/types/segmentation';
import { segmentFillAlpha } from '@/src/components/vtk/segmentDisplay';
import { usePolygonStore } from '@/src/store/tools/polygons';

// ---------------------------------------------------------------------------
// The 6.4.0 -> 7.0.0 structural migration. JSON only: every old segment group
// becomes one `SegmentationArtifact` plus one `Segment` per `{group, value}`,
// every old vector-tool label becomes one segment per `{labelId, imageId}` pair,
// and identity is NEVER merged by name or by label value across groups/images.
// ---------------------------------------------------------------------------

const SOURCE = {
  providerId: 'analysis-provider',
  jobId: 'job-abc',
  outputId: 'outputLabelmap',
};

const legacyManifest = (overrides: Record<string, unknown>) =>
  JSON.stringify({
    version: '6.4.0',
    dataSources: [
      { id: 1, type: 'uri', uri: 'https://ex/ct.nrrd', name: 'CT' },
      { id: 2, type: 'uri', uri: 'https://ex/mr.nrrd', name: 'MR' },
    ],
    datasets: [
      { id: 'ds-ct', dataSourceId: 1 },
      { id: 'ds-mr', dataSourceId: 2 },
    ],
    ...overrides,
  });

const migrate = (overrides: Record<string, unknown>) =>
  migrateManifest(legacyManifest(overrides)) as any;

type LegacyMask = {
  value: number;
  name: string;
  color: [number, number, number, number];
  visible?: boolean;
  locked?: boolean;
};

const segmentsBlock = (masks: LegacyMask[]) => ({
  order: masks.map((mask) => mask.value),
  byValue: Object.fromEntries(masks.map((mask) => [String(mask.value), mask])),
});

const legacyGroup = (
  id: string,
  parentImage: string,
  masks?: LegacyMask[],
  extras: Record<string, unknown> = {}
) => ({
  id,
  path: `segmentations/${id}.vti`,
  metadata: {
    name: id,
    parentImage,
    ...(masks ? { segments: segmentsBlock(masks) } : {}),
    ...extras,
  },
});

const TUMOR: LegacyMask = {
  value: 1,
  name: 'Tumor',
  color: [255, 0, 0, 255],
  visible: true,
  locked: true,
};
const EDEMA: LegacyMask = {
  value: 2,
  name: 'Edema',
  color: [0, 255, 0, 128],
  visible: false,
};
// No `visible`/`locked` keys at all: the old schema defaulted them on parse.
const BARE = { value: 3, name: '', color: [1, 2, 3, 4] } as LegacyMask;

// What the slice renderer multiplies out for a visible, opaque-coloured
// segment. A legacy group's opacity has to survive as this product, not as
// either factor on its own.
const effectiveFill = (segment: any, segmentation: any) =>
  segmentFillAlpha(
    { ...segment, visible: true, color: [0, 0, 0, 255] },
    segmentation.fillOpacity
  );

const segmentationFor = (migrated: any, parentImage: string) =>
  migrated.segmentations.find(
    (entry: any) => entry.parentImage === parentImage
  );

/** Wire segments of one segmentation, in `order`. */
const orderedSegments = (segmentation: any) =>
  segmentation.order.map((id: string) =>
    segmentation.segments.find((segment: any) => segment.id === id)
  );

const boundTo = (segmentation: any, artifactId: string, labelValue: number) =>
  orderedSegments(segmentation).find(
    (segment: any) =>
      segment.representations.labelmap?.artifactId === artifactId &&
      segment.representations.labelmap?.labelValue === labelValue
  );

describe('migrate640To700: structural stage', () => {
  it('reaches the current manifest version from every legacy version', () => {
    ['6.2.0', '6.3.0', '6.4.0'].forEach((version) => {
      const migrated = migrateManifest(
        JSON.stringify({ version, dataSources: [] })
      ) as any;
      expect(migrated.version).toBe(MANIFEST_VERSION);
    });
  });

  it('migrates a one-group manifest losslessly', () => {
    const migrated = migrate({
      segmentGroups: [
        legacyGroup('sg-1', 'ds-ct', [TUMOR, EDEMA, BARE], {
          name: 'Painted',
          source: SOURCE,
        }),
      ],
    });

    expect(migrated.version).toBe(MANIFEST_VERSION);
    expect(migrated.segmentGroups).toBeUndefined();

    expect(migrated.segmentationArtifacts).toHaveLength(1);
    expect(migrated.segmentationArtifacts[0]).toMatchObject({
      id: 'sg-1',
      parentImage: 'ds-ct',
      name: 'Painted',
      path: 'segmentations/sg-1.vti',
      source: SOURCE,
    });
    expect(migrated.segmentationArtifacts[0].pendingDecode).toBeFalsy();

    expect(migrated.segmentations).toHaveLength(1);
    const segmentation = migrated.segmentations[0];
    expect(segmentation.parentImage).toBe('ds-ct');
    expect(segmentation.order).toHaveLength(3);

    const segments = orderedSegments(segmentation);
    expect(
      segments.map((segment: any) => ({
        name: segment.name,
        color: segment.color,
        visible: segment.visible,
        locked: segment.locked,
        labelValue: segment.representations.labelmap.labelValue,
        artifactId: segment.representations.labelmap.artifactId,
      }))
    ).toEqual([
      {
        name: 'Tumor',
        color: [255, 0, 0, 255],
        visible: true,
        locked: true,
        labelValue: 1,
        artifactId: 'sg-1',
      },
      {
        name: 'Edema',
        color: [0, 255, 0, 128],
        visible: false,
        locked: false,
        labelValue: 2,
        artifactId: 'sg-1',
      },
      {
        name: '',
        color: [1, 2, 3, 4],
        visible: true,
        locked: false,
        labelValue: 3,
        artifactId: 'sg-1',
      },
    ]);
    // The extent is a placeholder resolved against the parent at load time.
    segments.forEach((segment: any) =>
      expect(segment.representations.labelmap.extent).toHaveLength(6)
    );

    const parsed = ManifestSchema.parse(migrated);
    // Parse fills the 7.0.0 display-state defaults the raw migration output
    // does not carry; add those to the raw output before checking the
    // migration itself is otherwise lossless.
    const expectedSegmentations = migrated.segmentations.map((wire: any) => ({
      ...wire,
      fillOpacity: DEFAULT_SEGMENTATION_FILL_OPACITY,
      outlineOpacity: 1,
      outlineThickness: 2,
      segments: wire.segments.map((segment: any) => ({
        ...segment,
        fillOpacity: 1,
        outlineOpacity: 1,
      })),
    }));
    expect(parsed.segmentations).toEqual(expectedSegmentations);
    expect(parsed.segmentationArtifacts![0]).toMatchObject({ id: 'sg-1' });
  });

  it.each([
    {
      source: 'a named URI',
      dataSources: [
        { id: 10, type: 'uri', uri: 'https://ex/scan.nrrd', name: 'CT Chest' },
      ],
      expected: 'CT Chest',
    },
    {
      source: 'an unnamed URI',
      dataSources: [{ id: 10, type: 'uri', uri: 'https://ex/scan.nrrd' }],
      expected: 'scan.nrrd',
    },
    {
      source: 'a local file',
      dataSources: [
        { id: 10, type: 'file', fileId: 42, fileType: 'application/nrrd' },
      ],
      datasetFilePath: { '42': 'datasets/42/patient.nrrd' },
      expected: 'patient.nrrd',
    },
    {
      source: 'an archive member',
      dataSources: [
        { id: 10, type: 'uri', uri: 'https://ex/study.zip' },
        { id: 11, type: 'archive', path: 'study/series/scan.nrrd', parent: 10 },
      ],
      datasetSourceId: 11,
      expected: 'scan.nrrd',
    },
    {
      source: 'a collection',
      dataSources: [
        { id: 10, type: 'collection', sources: [11, 12] },
        { id: 11, type: 'uri', uri: 'https://ex/first.nrrd' },
        { id: 12, type: 'uri', uri: 'https://ex/second.nrrd' },
      ],
      expected: 'first.nrrd, second.nrrd',
    },
  ])('names a segmentation from $source', (testCase) => {
    const migrated = migrate({
      dataSources: testCase.dataSources,
      datasets: [
        { id: 'ds-local', dataSourceId: testCase.datasetSourceId ?? 10 },
      ],
      ...(testCase.datasetFilePath
        ? { datasetFilePath: testCase.datasetFilePath }
        : {}),
      segmentGroups: [legacyGroup('sg-1', 'ds-local', [TUMOR])],
    });

    expect(segmentationFor(migrated, 'ds-local').name).toBe(testCase.expected);
    expect(() => ManifestSchema.parse(migrated)).not.toThrow();
  });

  it('preserves a path-less group’s dataSourceId', () => {
    const migrated = migrate({
      segmentGroups: [
        {
          id: 'sg-1',
          dataSourceId: 7,
          metadata: { name: 'Painted', parentImage: 'ds-ct' },
        },
      ],
    });

    expect(migrated.segmentationArtifacts[0]).toMatchObject({
      id: 'sg-1',
      dataSourceId: 7,
    });
    expect(migrated.segmentationArtifacts[0].path).toBeUndefined();
    expect(() => ManifestSchema.parse(migrated)).not.toThrow();
  });

  it('keeps multi-group order deterministic', () => {
    const migrated = migrate({
      segmentGroups: [
        legacyGroup('sg-a', 'ds-ct', [TUMOR]),
        legacyGroup('sg-b', 'ds-ct', [EDEMA]),
        legacyGroup('sg-c', 'ds-mr', [TUMOR]),
      ],
    });

    expect(
      migrated.segmentationArtifacts.map((artifact: any) => artifact.id)
    ).toEqual(['sg-a', 'sg-b', 'sg-c']);
    expect(
      migrated.segmentations.map((entry: any) => entry.parentImage)
    ).toEqual(['ds-ct', 'ds-mr']);

    const ct = segmentationFor(migrated, 'ds-ct');
    expect(
      orderedSegments(ct).map((segment: any) => [
        segment.name,
        segment.representations.labelmap.artifactId,
      ])
    ).toEqual([
      ['Tumor', 'sg-a'],
      ['Edema', 'sg-b'],
    ]);
  });

  it('keeps equal and default names distinct segments', () => {
    const sameName: LegacyMask = {
      value: 1,
      name: 'Segment 1',
      color: [10, 20, 30, 255],
      visible: true,
    };
    const migrated = migrate({
      segmentGroups: [
        legacyGroup('sg-a', 'ds-ct', [sameName]),
        legacyGroup('sg-b', 'ds-ct', [sameName]),
      ],
    });

    const ct = segmentationFor(migrated, 'ds-ct');
    const segments = orderedSegments(ct);
    expect(segments.map((segment: any) => segment.name)).toEqual([
      'Segment 1',
      'Segment 1',
    ]);
    expect(new Set(segments.map((segment: any) => segment.id)).size).toBe(2);
    expect(
      segments.map(
        (segment: any) => segment.representations.labelmap.artifactId
      )
    ).toEqual(['sg-a', 'sg-b']);
  });

  it('marks a descriptorless group for decode and emits no segments for it', () => {
    const migrated = migrate({
      segmentGroups: [legacyGroup('sg-blind', 'ds-ct')],
    });

    expect(migrated.segmentationArtifacts).toHaveLength(1);
    expect(migrated.segmentationArtifacts[0]).toMatchObject({
      id: 'sg-blind',
      parentImage: 'ds-ct',
      pendingDecode: true,
    });
    expect(
      (migrated.segmentations ?? []).flatMap((entry: any) => entry.segments)
    ).toEqual([]);

    // The marker must survive the schema, or the loaded stage never sees it.
    const parsed = ManifestSchema.parse(migrated) as any;
    expect(parsed.segmentationArtifacts[0].pendingDecode).toBe(true);
  });

  it('carries the active value of a descriptorless group for post-decode restore', () => {
    const migrated = migrate({
      segmentGroups: [legacyGroup('sg-blind', 'ds-ct')],
      tools: { paint: { activeSegmentGroupID: 'sg-blind', activeSegment: 2 } },
    });

    // No segment exists to activate yet, so the value travels on the artifact.
    expect(
      (migrated.segmentations ?? []).flatMap((entry: any) => entry.segments)
    ).toEqual([]);
    expect(migrated.segmentationArtifacts[0].pendingActiveValue).toBe(2);

    const parsed = ManifestSchema.parse(migrated) as any;
    expect(parsed.segmentationArtifacts[0].pendingActiveValue).toBe(2);
  });

  it('does not emit a pending active value for a legacy null selection', () => {
    const migrated = migrate({
      segmentGroups: [legacyGroup('sg-blind', 'ds-ct')],
      tools: {
        paint: { activeSegmentGroupID: 'sg-blind', activeSegment: null },
      },
    });

    expect(
      migrated.segmentationArtifacts[0].pendingActiveValue
    ).toBeUndefined();
    expect(() => ManifestSchema.parse(migrated)).not.toThrow();
  });

  it('moves legacy group display settings onto the segment model', () => {
    const migrated = migrate({
      segmentGroups: [legacyGroup('sg-1', 'ds-ct', [TUMOR])],
      viewByID: {
        Axial: {
          config: {
            'sg-1': {
              layers: { blendConfig: { opacity: 0.4, visibility: false } },
              segmentGroup: { outlineOpacity: 0.25, outlineThickness: 5 },
            },
          },
        },
      },
    });

    const segmentation = segmentationFor(migrated, 'ds-ct');
    expect(orderedSegments(segmentation)[0]).toMatchObject({
      visible: false,
      outlineOpacity: 0.25,
    });
    expect(
      effectiveFill(orderedSegments(segmentation)[0], segmentation)
    ).toBeCloseTo(0.4);
    expect(segmentation.outlineThickness).toBe(5);
    expect(migrated.segmentationArtifacts[0]).toMatchObject({
      pendingFillOpacity: 1,
      pendingOutlineOpacity: 0.25,
      pendingVisibility: false,
    });
    expect(migrated.viewByID.Axial.config['sg-1']).toBeUndefined();
  });

  it('keeps the legacy fill default when no view configured the group', () => {
    const migrated = ManifestSchema.parse(
      migrate({ segmentGroups: [legacyGroup('sg-1', 'ds-ct', [TUMOR])] })
    ) as any;

    const segmentation = segmentationFor(migrated, 'ds-ct');
    expect(
      effectiveFill(orderedSegments(segmentation)[0], segmentation)
    ).toBeCloseTo(DEFAULT_SEGMENTATION_FILL_OPACITY);
  });

  it('keeps each merged group’s own fill when they disagree', () => {
    const migrated = ManifestSchema.parse(
      migrate({
        segmentGroups: [
          legacyGroup('sg-1', 'ds-ct', [TUMOR]),
          legacyGroup('sg-2', 'ds-ct', [EDEMA]),
        ],
        viewByID: {
          Axial: {
            id: 'Axial',
            name: 'Axial',
            type: '2D',
            config: {
              'sg-1': { layers: { blendConfig: { opacity: 0.2 } } },
              'sg-2': { layers: { blendConfig: { opacity: 0.8 } } },
            },
          },
        },
      })
    ) as any;

    const segmentation = segmentationFor(migrated, 'ds-ct');
    const [tumor, edema] = orderedSegments(segmentation);
    expect(effectiveFill(tumor, segmentation)).toBeCloseTo(0.2);
    expect(effectiveFill(edema, segmentation)).toBeCloseTo(0.8);
    // The per-segment slider only holds a fraction, so the larger of the two
    // is what the segmentation carries.
    expect(
      orderedSegments(segmentation).map((s: any) => s.fillOpacity <= 1)
    ).toEqual([true, true]);
  });

  it('uses the first configured thickness when legacy groups are merged', () => {
    const migrated = migrate({
      segmentGroups: [
        legacyGroup('sg-1', 'ds-ct', [TUMOR]),
        legacyGroup('sg-2', 'ds-ct', [EDEMA]),
      ],
      viewByID: {
        Axial: {
          config: {
            'sg-1': {
              segmentGroup: { outlineOpacity: 1, outlineThickness: 3 },
            },
            'sg-2': {
              segmentGroup: { outlineOpacity: 1, outlineThickness: 7 },
            },
            'ds-ct': { slice: { slice: 2 } },
          },
        },
        Coronal: {
          config: {
            'sg-1': {
              segmentGroup: { outlineOpacity: 0.5, outlineThickness: 9 },
            },
          },
        },
      },
    });

    expect(segmentationFor(migrated, 'ds-ct').outlineThickness).toBe(3);
    expect(migrated.viewByID.Axial.config).toEqual({
      'ds-ct': { slice: { slice: 2 } },
    });
    expect(migrated.viewByID.Coronal.config).toEqual({});
  });

  it('keeps deferred legacy display settings through schema parsing', () => {
    const migrated = migrate({
      segmentGroups: [legacyGroup('sg-blind', 'ds-ct')],
      viewByID: {
        Axial: {
          id: 'Axial',
          name: 'Axial',
          type: '2D',
          config: {
            'sg-blind': {
              segmentGroup: { outlineOpacity: 0.25, outlineThickness: 5 },
            },
          },
        },
      },
    });

    const parsed = ManifestSchema.parse(migrated) as any;
    expect(parsed.segmentationArtifacts[0].pendingOutlineOpacity).toBe(0.25);
    expect(parsed.segmentations[0].outlineThickness).toBe(5);
  });

  it('maps the active group and value to the matching segment id', () => {
    const migrated = migrate({
      segmentGroups: [
        legacyGroup('sg-a', 'ds-ct', [TUMOR, EDEMA]),
        legacyGroup('sg-b', 'ds-ct', [TUMOR, EDEMA]),
      ],
      tools: {
        paint: {
          activeSegmentGroupID: 'sg-b',
          activeSegment: 2,
          brushSize: 6,
          crossPlaneSync: true,
        },
      },
    });

    const ct = segmentationFor(migrated, 'ds-ct');
    expect(ct.activeSegment).toBe(boundTo(ct, 'sg-b', 2).id);

    // Identity left the paint block entirely; its own settings survive.
    expect(migrated.tools.paint.activeSegmentGroupID).toBeUndefined();
    expect(migrated.tools.paint.activeSegment).toBeUndefined();
    expect(migrated.tools.paint).toMatchObject({
      brushSize: 6,
      crossPlaneSync: true,
    });
    expect(() => ManifestSchema.parse(migrated)).not.toThrow();
  });

  it('converts a vector-tool label shared across two images into two segments', () => {
    const polygon = (imageID: string, slice: number) => ({
      imageID,
      frameOfReference: { planeOrigin: [0, 0, slice], planeNormal: [0, 0, 1] },
      slice,
      label: 'lbl-tumor',
      points: [
        [1, 1, slice],
        [5, 1, slice],
        [3, 5, slice],
      ],
    });

    const migrated = migrate({
      tools: {
        polygons: {
          tools: [polygon('ds-ct', 3), polygon('ds-mr', 4)],
          labels: {
            'lbl-tumor': { labelName: 'Tumor', color: 'red', strokeWidth: 3 },
          },
        },
      },
    });

    const ct = segmentationFor(migrated, 'ds-ct');
    const mr = segmentationFor(migrated, 'ds-mr');
    const ctSegment = orderedSegments(ct)[0];
    const mrSegment = orderedSegments(mr)[0];

    // One segment per {label, image} pair; never bridged across images.
    expect(ct.segments).toHaveLength(1);
    expect(mr.segments).toHaveLength(1);
    expect(ctSegment.id).not.toBe(mrSegment.id);
    expect([ctSegment.name, mrSegment.name]).toEqual(['Tumor', 'Tumor']);
    expect(ctSegment.color).toEqual([255, 0, 0, 255]);
    // A vector-tool label has no voxels.
    expect(ctSegment.representations.labelmap).toBeUndefined();
    expect(mrSegment.representations.labelmap).toBeUndefined();

    expect(
      migrated.tools.polygons.tools.map((tool: any) => tool.label)
    ).toEqual([ctSegment.id, mrSegment.id]);
    expect(migrated.tools.polygons.labels).toBeUndefined();
    expect(migrated.tools.polygons.segmentProps).toEqual({
      [ctSegment.id]: expect.objectContaining({ strokeWidth: 3 }),
      [mrSegment.id]: expect.objectContaining({ strokeWidth: 3 }),
    });
    expect(() => ManifestSchema.parse(migrated)).not.toThrow();
  });

  it('keeps a label no tool used as a template', () => {
    const polygon = (imageID: string, slice: number) => ({
      imageID,
      label: 'lbl-tumor',
      slice,
      frameOfReference: {
        planeOrigin: [0, 0, slice],
        planeNormal: [0, 0, 1],
      },
      points: [
        [1, 1, slice],
        [5, 1, slice],
        [3, 5, slice],
      ],
    });

    const migrated = migrate({
      tools: {
        polygons: {
          tools: [polygon('ds-ct', 3)],
          labels: {
            'lbl-tumor': { labelName: 'Tumor', color: 'red', strokeWidth: 3 },
            'lbl-node': { labelName: 'Node', color: 'blue', strokeWidth: 1 },
          },
        },
      },
    });

    const segments = orderedSegments(segmentationFor(migrated, 'ds-ct'));
    // The used label became a segment; the unused one has no image to be a
    // segment of, so it stays offered as a template.
    expect(segments.map((segment: any) => segment.name)).toEqual(['Tumor']);
    expect(migrated.tools.polygons.templates).toEqual({
      Node: { color: 'blue', strokeWidth: 1 },
    });
    expect(() => ManifestSchema.parse(migrated)).not.toThrow();
  });

  it('converts CSS label colors to RGBA', () => {
    const rectangle = (label: string) => ({
      imageID: 'ds-ct',
      frameOfReference: { planeOrigin: [0, 0, 1], planeNormal: [0, 0, 1] },
      slice: 1,
      label,
      firstPoint: [1, 1, 1],
      secondPoint: [4, 4, 1],
    });

    const migrated = migrate({
      tools: {
        rectangles: {
          tools: [rectangle('lbl-a'), rectangle('lbl-b'), rectangle('lbl-c')],
          labels: {
            'lbl-a': { labelName: 'Named', color: 'blue' },
            'lbl-b': { labelName: 'Hex', color: '#00ff00' },
            'lbl-c': { labelName: 'Hexa', color: '#0000ff80' },
          },
        },
      },
    });

    const ct = segmentationFor(migrated, 'ds-ct');
    expect(
      orderedSegments(ct).map((segment: any) => [segment.name, segment.color])
    ).toEqual([
      ['Named', [0, 0, 255, 255]],
      ['Hex', [0, 255, 0, 255]],
      ['Hexa', [0, 0, 255, 128]],
    ]);
  });

  it('keeps ruler labels on the ruler entry, untouched', () => {
    const migrated = migrate({
      tools: {
        rulers: {
          tools: [
            {
              imageID: 'ds-ct',
              frameOfReference: {
                planeOrigin: [0, 0, 5],
                planeNormal: [0, 0, 1],
              },
              slice: 5,
              label: 'lbl-long',
              firstPoint: [1, 1, 5],
              secondPoint: [4, 4, 5],
            },
          ],
          labels: { 'lbl-long': { labelName: 'Long axis', color: 'red' } },
        },
      },
    });

    expect(migrated.version).toBe(MANIFEST_VERSION);
    expect(migrated.tools.rulers.labels).toEqual({
      'lbl-long': { labelName: 'Long axis', color: 'red' },
    });
    expect(migrated.tools.rulers.tools[0].label).toBe('lbl-long');
    // Rulers own their labels: no segment is minted for one.
    expect(
      (migrated.segmentations ?? []).flatMap((entry: any) => entry.segments)
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Loaded stage + round trip: a migrated 6.4.0 file restores through the real
// import path, resolves its placeholder extents against the loaded parent, and
// re-saves as 7.0.0 that reloads identically.
// ---------------------------------------------------------------------------

const DIMENSIONS: [number, number, number] = [4, 4, 2];
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

function makeImage(fill: (values: Uint8Array) => void = () => {}) {
  const image = vtkImageData.newInstance({ spacing: [1, 1, 1] });
  image.setDimensions(DIMENSIONS);
  const values = new Uint8Array(VOXEL_COUNT);
  fill(values);
  image
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));
  image.computeTransforms();
  return image;
}

const seatImage = async (id: string, name: string, image = makeImage()) => {
  useImageCacheStore().addVTKImageData(image, name, { id });
  await nextTick();
  return id;
};

// The real collaborator is itk-wasm image IO, which has no node counterpart;
// this local codec keeps the labelmap in memory behind an archive token.
const makeArtifactIO = () => {
  const labelmaps = new Map<string, any>();
  return {
    write: async (_format: string, labelmap: any) => {
      const token = `labelmap-${labelmaps.size}`;
      labelmaps.set(token, labelmap);
      return token;
    },
    read: async (file: File) => ({ image: labelmaps.get(await file.text()) }),
  };
};

const snapshot = (imageId: string) => {
  const store = useSegmentationStore();
  const segmentation = store.getSegmentationForImage(imageId)!;
  const activeId = store.activeSegmentId;
  return {
    name: segmentation.name,
    segments: segmentation.order.map((segmentId) => {
      const segment = segmentation.segments[segmentId];
      const binding = segment.representations.labelmap;
      return {
        name: segment.name,
        color: [...segment.color],
        visible: segment.visible,
        locked: segment.locked,
        fillOpacity: segment.fillOpacity,
        outlineOpacity: segment.outlineOpacity,
        binding: binding && {
          labelValue: binding.labelValue,
          extent: [...binding.extent],
          artifactName: store.artifactMeta[binding.artifactId].name,
          artifactSource: store.artifactMeta[binding.artifactId].source,
        },
      };
    }),
    activeSegmentName:
      activeId && segmentation.segments[activeId]
        ? segmentation.segments[activeId].name
        : undefined,
    display: {
      fillOpacity: segmentation.fillOpacity,
      outlineOpacity: segmentation.outlineOpacity,
      outlineThickness: segmentation.outlineThickness,
    },
  };
};

const legacyScene = () =>
  JSON.stringify({
    version: '6.4.0',
    dataSources: [
      { id: 1, type: 'uri', uri: 'https://ex/ct.nrrd', name: 'CT' },
      { id: 3, type: 'uri', uri: 'https://ex/tumor.seg.nrrd', name: 'Tumor' },
    ],
    datasets: [{ id: 'ds-ct', dataSourceId: 1 }],
    viewByID: {
      Axial: {
        id: 'Axial',
        name: 'Axial',
        type: '2D',
        config: {
          'sg-1': {
            layers: {
              colorBy: { arrayName: '', location: 'pointData' },
              transferFunction: { preset: '', mappingRange: [0, 1] },
              opacityFunction: {
                mode: 0,
                gaussians: [],
                mappingRange: [0, 1],
              },
              blendConfig: { opacity: 0.4, visibility: false },
            },
            segmentGroup: { outlineOpacity: 0.25, outlineThickness: 5 },
          },
        },
      },
    },
    segmentGroups: [
      {
        id: 'sg-1',
        dataSourceId: 3,
        metadata: {
          name: 'Painted',
          parentImage: 'ds-ct',
          source: SOURCE,
          segments: segmentsBlock([TUMOR, EDEMA]),
        },
      },
    ],
    tools: {
      // No brushSize: setting it needs the app's $paint pinia plugin.
      paint: { activeSegmentGroupID: 'sg-1', activeSegment: 2 },
      polygons: {
        tools: [
          {
            imageID: 'ds-ct',
            frameOfReference: {
              planeOrigin: [0, 0, 1],
              planeNormal: [0, 0, 1],
            },
            slice: 1,
            label: 'lbl-drawn',
            points: [
              [1, 1, 1],
              [3, 1, 1],
              [2, 3, 1],
            ],
          },
        ],
        labels: {
          'lbl-drawn': { labelName: 'Drawn', color: 'blue' },
          // Declared, never drawn with.
          'lbl-planned': { labelName: 'Planned', color: 'green' },
        },
      },
    },
  });

const legacyLocalFileScene = () => {
  const manifest = JSON.parse(legacyScene());
  manifest.dataSources[0] = {
    id: 1,
    type: 'file',
    fileId: 10,
    fileType: 'application/nrrd',
  };
  manifest.datasetFilePath = { '10': 'datasets/10/patient.nrrd' };
  return JSON.stringify(manifest);
};

const restoreLegacyScene = async (scene = legacyScene()) => {
  const manifest = ManifestSchema.parse(migrateManifest(scene));
  await seatImage('store-ct', 'CT');
  await seatImage(
    'store-tumor',
    'Tumor',
    makeImage((values) => {
      values.fill(1, 4, 12);
      values.fill(2, 12, 20);
    })
  );
  await completeStateFileRestore(manifest, [], {
    'ds-ct': 'store-ct',
    [leafStateId(3)]: 'store-tumor',
  });
  await nextTick();
};

describe('migrated 6.4.0 state file: loaded stage and round trip', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('bounds each migrated segment to the voxels its value covers', async () => {
    await restoreLegacyScene();

    const store = useSegmentationStore();
    const segmentation = store.getSegmentationForImage('store-ct')!;
    const bindings = segmentation.order.map(
      (id) => segmentation.segments[id].representations.labelmap
    );
    // The migrated polygon label rides in the same segmentation, third and
    // unbound: only the two labelmap segments have voxels to bound.
    expect(bindings.map((binding) => binding?.labelValue)).toEqual([
      1,
      2,
      undefined,
    ]);
    expect(bindings.map((binding) => binding && [...binding.extent])).toEqual([
      [0, 3, 1, 2, 0, 0],
      [0, 3, 0, 3, 0, 1],
      undefined,
    ]);
  });

  it('restores the migrated active segment and vector-tool segment', async () => {
    await restoreLegacyScene();

    const store = useSegmentationStore();
    const segmentation = store.getSegmentationForImage('store-ct')!;
    const activeId = store.activeSegmentId!;
    expect(segmentation.segments[activeId].name).toBe('Edema');
    expect(
      segmentation.order.map((id) => segmentation.segments[id].name)
    ).toEqual(['Tumor', 'Edema', 'Drawn']);

    const polygons = usePolygonStore();
    expect(polygons.toolByID[polygons.toolIDs[0]].labelName).toBe('Drawn');
  });

  it('restores legacy display state onto durable segments', async () => {
    await restoreLegacyScene();

    const segmentation =
      useSegmentationStore().getSegmentationForImage('store-ct')!;
    const [tumor, edema, drawn] = segmentation.order.map(
      (id) => segmentation.segments[id]
    );
    expect([tumor, edema]).toEqual([
      expect.objectContaining({ visible: false, outlineOpacity: 0.25 }),
      expect.objectContaining({ visible: false, outlineOpacity: 0.25 }),
    ]);
    // Both groups rendered at the legacy 0.4, and that is what the restored
    // pair of opacities has to come to.
    [tumor, edema].forEach((segment) =>
      expect(effectiveFill(segment, segmentation)).toBeCloseTo(0.4)
    );
    expect(drawn).toMatchObject({ fillOpacity: 1, outlineOpacity: 1 });
    expect(segmentation.outlineThickness).toBe(5);
  });

  it('offers a legacy label no tool used as a template', async () => {
    await restoreLegacyScene();

    const polygons = usePolygonStore();
    const labelNames = Object.values(polygons.allLabels).map(
      (label: any) => label.labelName
    );
    expect(labelNames).toContain('Planned');

    // It is a template, not a segment: nothing was drawn with it.
    const segmentation =
      useSegmentationStore().getSegmentationForImage('store-ct')!;
    expect(
      segmentation.order.map((id) => segmentation.segments[id].name)
    ).not.toContain('Planned');
  });

  it('re-saves as 7.0.0 and reloads identically', async () => {
    await restoreLegacyScene(legacyLocalFileScene());
    const before = snapshot('store-ct');
    expect(before.name).toBe('patient.nrrd');

    const io = makeArtifactIO();
    const zip = new JSZip();
    const manifest = {
      version: MANIFEST_VERSION,
      datasets: [{ id: 'store-ct', dataSourceId: 1 }],
      dataSources: [{ id: 1, type: 'uri', uri: 'https://ex/ct.nrrd' }],
      datasetFilePath: {},
      tools: {},
    } as unknown as Manifest;

    await useSegmentationStore().serialize({ zip, manifest }, io);
    const saved = ManifestSchema.parse(manifest) as any;
    expect(saved.version).toBe(MANIFEST_VERSION);
    expect(saved.segmentGroups).toBeUndefined();

    const stateFiles = await Promise.all(
      saved.segmentationArtifacts.map(async (artifact: any) => ({
        archivePath: artifact.path,
        file: new File(
          [await zip.file(artifact.path)!.async('string')],
          'artifact.vti'
        ),
      }))
    );

    setActivePinia(createPinia());
    await seatImage('new-ct', 'CT');
    await useSegmentationStore().deserialize(
      saved,
      stateFiles,
      { 'store-ct': 'new-ct' },
      {},
      io
    );
    await nextTick();

    expect(snapshot('new-ct')).toEqual(before);
  });

  it('keeps colliding legacy identifiers as distinct segments', () => {
    // Group 'polygons-1-img' value 2 and a polygon labelled '1' on 'img-2'
    // both interpolate to 'polygons-1-img-2'.
    const migrated: any = migrateManifest(
      JSON.stringify({
        version: '6.4.0',
        datasets: [{ id: 'img-2', dataSourceId: 1 }],
        dataSources: [{ id: 1, type: 'uri', uri: '/img-2' }],
        segmentGroups: [
          {
            id: 'polygons-1-img',
            path: 'group.vti',
            metadata: {
              parentImage: 'img-2',
              name: 'Group',
              segments: {
                order: [2],
                byValue: {
                  '2': { value: 2, name: 'Voxels', color: [1, 2, 3, 255] },
                },
              },
            },
          },
        ],
        tools: {
          polygons: {
            labels: { '1': { labelName: 'Vector', color: '#00ff00' } },
            tools: [{ id: 't1', label: '1', imageID: 'img-2' }],
          },
        },
      })
    );

    const ids = migrated.segmentations[0].segments.map((s: any) => s.id);
    // Both sources interpolate to 'polygons-1-img-2'; the second is suffixed.
    expect(ids).toEqual(['polygons-1-img-2', 'polygons-1-img-2-2']);
    expect(migrated.tools.polygons.tools[0].label).toBe('polygons-1-img-2-2');
  });
});
