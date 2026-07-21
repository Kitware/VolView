import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useImageCacheStore } from '@/src/store/image-cache';
import { leafStateId } from '@/src/io/import/dataSource';
import { resolveArtifactRestoreSources } from '@/src/io/import/processors/restoreStateFile';
import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';

// ---------------------------------------------------------------------------
// Compose-validity refinement PARITY PIN: segment descriptors are OPTIONAL on
// a composed segment group. When they are absent, the composed restore MUST
// reuse the exact decode/enumerate/default-name/default-color path that live
// `convertImageToLabelmap` uses — never a backend-authored empty catalog, and
// never a parallel client reimplementation. These tests pin the two paths to
// IDENTICAL segment catalogs for the same descriptor-less labelmap, with and
// without embedded `.seg.nrrd` metadata.
// ---------------------------------------------------------------------------

// `writeSegmentation` spawns a real Worker; keep the IO module out of the test.
const ioMocks = vi.hoisted(() => ({
  readImage: vi.fn(),
  writeSegmentation: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock('@/src/io/readWriteImage', () => ({
  readImage: ioMocks.readImage,
  writeSegmentation: ioMocks.writeSegmentation,
}));

const BASE_URI = 'volview-backend:base/ct-chest-001';
const ARTIFACT_URI = 'volview-backend:artifact/tumor-seg/v2';

// A labelmap with voxel values {0, 1, 2}: background plus two segments.
function makeLabelmapImage() {
  const image = vtkImageData.newInstance();
  image.setDimensions([4, 4, 4]);
  const values = new Uint8Array(4 * 4 * 4);
  values.fill(0, 0, 20);
  values.fill(1, 20, 44);
  values.fill(2, 44);
  image
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));
  image.computeTransforms();
  return image;
}

function makeSparseLabelmapImage() {
  const image = vtkImageData.newInstance();
  image.setDimensions([4, 4, 4]);
  const values = new Uint8Array(4 * 4 * 4);
  values.fill(1, 8, 16);
  values.fill(255, 48);
  image
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));
  image.computeTransforms();
  return image;
}

function makeParentImage() {
  const image = vtkImageData.newInstance();
  image.setDimensions([4, 4, 4]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(4 * 4 * 4),
    })
  );
  image.computeTransforms();
  return image;
}

// A parent-bound, descriptor-less group: metadata carries name + parentImage,
// NO segments.
const descriptorlessComposedManifest = (): Manifest =>
  ManifestSchema.parse({
    version: '6.4.0',
    dataSources: [
      { id: 1, type: 'uri', uri: BASE_URI, name: 'CT Chest' },
      {
        id: 3,
        type: 'uri',
        uri: ARTIFACT_URI,
        name: 'Tumor.seg.nrrd',
        mime: 'application/octet-stream',
      },
    ],
    datasets: [{ id: 'ds-ct', dataSourceId: 1 }],
    segmentGroups: [
      {
        id: 'sg-tumor',
        dataSourceId: 3,
        metadata: { name: 'Tumor', parentImage: 'ds-ct' },
      },
    ],
  });

const descriptorlessArchiveManifest = (): Manifest =>
  ManifestSchema.parse({
    version: '6.4.0',
    dataSources: [{ id: 1, type: 'uri', uri: BASE_URI, name: 'CT Chest' }],
    datasets: [{ id: 'ds-ct', dataSourceId: 1 }],
    segmentGroups: [
      {
        id: 'sg-tumor',
        path: 'segmentations/Tumor.seg.nrrd',
        metadata: { name: 'Tumor', parentImage: 'ds-ct' },
      },
    ],
  });

const seat = (
  id: string,
  name: string,
  image: vtkImageData,
  headerMetadata?: Map<string, string>
) => useImageCacheStore().addVTKImageData(image, name, { id, headerMetadata });

// The LIVE path: what convertImageToLabelmap builds for this labelmap.
async function liveCatalog(segmentMetadata?: Map<string, string>) {
  setActivePinia(createPinia());
  seat('parent-img', 'CT Chest', makeParentImage());
  seat('child-img', 'Tumor.seg.nrrd', makeLabelmapImage(), segmentMetadata);
  const store = useSegmentGroupStore();
  const [groupId] = await store.convertImageToLabelmap(
    'child-img',
    'parent-img'
  );
  return JSON.parse(JSON.stringify(store.metadataByID[groupId].segments));
}

// The COLD path: what deserialize builds from a descriptor-less composed
// manifest whose artifact materialized as a loaded dataset.
async function coldCatalog(segmentMetadata?: Map<string, string>) {
  setActivePinia(createPinia());
  seat('parent-store', 'CT Chest', makeParentImage());
  seat(
    'artifact-store',
    'Tumor.seg.nrrd',
    makeLabelmapImage(),
    segmentMetadata
  );
  const store = useSegmentGroupStore();
  const manifest = descriptorlessComposedManifest();
  const { segmentGroupIDMap: idMap } = await store.deserialize(
    manifest,
    [],
    {
      'ds-ct': 'parent-store',
      [leafStateId(3)]: 'artifact-store',
    },
    resolveArtifactRestoreSources(manifest)
  );
  const groupId = idMap['sg-tumor'];
  expect(groupId).toBeDefined();
  return JSON.parse(JSON.stringify(store.metadataByID[groupId].segments));
}

describe('descriptor-less segment catalogs: cold restore == live conversion (parity pin)', () => {
  beforeEach(() => {
    ioMocks.readImage.mockReset();
  });

  it('defaults-only labelmap: identical enumeration, names, and colors', async () => {
    const live = await liveCatalog();
    const cold = await coldCatalog();

    // Sanity on the live shape: the full non-background enumeration got
    // default names/colors — not an empty catalog.
    expect(live.order).toEqual([1, 2]);
    expect(live.byValue[1].name).toBe('Segment 1');
    expect(live.byValue[2].name).toBe('Segment 2');

    expect(cold).toEqual(live);
  });

  it('embedded .seg.nrrd metadata: identical overlay result in both paths', async () => {
    const embedded = () =>
      new Map<string, string>([
        ['Segment0_LabelValue', '2'],
        ['Segment0_Name', 'Tumor core'],
        ['Segment0_Color', '1 0 0'],
      ]);
    const live = await liveCatalog(embedded());
    const cold = await coldCatalog(embedded());

    // The described value carries its embedded name; the undescribed value
    // still gets its default (merge, not replace).
    expect(live.byValue[2].name).toBe('Tumor core');
    expect(live.byValue[1].name).toBe('Segment 1');

    expect(cold).toEqual(live);
  });

  it('preserves embedded metadata from an archive-backed .seg.nrrd', async () => {
    setActivePinia(createPinia());
    seat('parent-store', 'CT Chest', makeParentImage());
    ioMocks.readImage.mockResolvedValue({
      image: makeLabelmapImage(),
      headerMetadata: new Map<string, string>([
        ['Segment0_LabelValue', '2'],
        ['Segment0_Name', 'Tumor core'],
        ['Segment0_Color', '1 0 0'],
      ]),
    });

    const store = useSegmentGroupStore();
    const { segmentGroupIDMap: idMap } = await store.deserialize(
      descriptorlessArchiveManifest(),
      [
        {
          archivePath: 'segmentations/Tumor.seg.nrrd',
          file: new File([''], 'Tumor.seg.nrrd'),
        },
      ],
      { 'ds-ct': 'parent-store' }
    );

    const segments = store.metadataByID[idMap['sg-tumor']].segments;
    expect(segments.order).toEqual([1, 2]);
    expect(segments.byValue[1].name).toBe('Segment 1');
    expect(segments.byValue[2]).toMatchObject({
      name: 'Tumor core',
      color: [255, 0, 0, 255],
    });
  });

  it('enumerates only distinct sparse voxel labels', async () => {
    setActivePinia(createPinia());
    seat('parent-img', 'CT Chest', makeParentImage());
    seat('child-img', 'Sparse.seg.nrrd', makeSparseLabelmapImage());
    const store = useSegmentGroupStore();

    const [groupId] = await store.convertImageToLabelmap(
      'child-img',
      'parent-img'
    );

    expect(store.metadataByID[groupId].segments.order).toEqual([1, 255]);
    expect(Object.keys(store.metadataByID[groupId].segments.byValue)).toEqual([
      '1',
      '255',
    ]);
  });

  it('enumerates no segments for an all-background labelmap', async () => {
    setActivePinia(createPinia());
    seat('parent-img', 'CT Chest', makeParentImage());
    // Every voxel is LABELMAP_BACKGROUND_VALUE (0): an all-background labelmap
    // built with the same all-zero image helper the parent uses. Distinct
    // nonzero labels are enumerated, so this labelmap has none.
    seat('child-img', 'Empty.seg.nrrd', makeParentImage());
    const store = useSegmentGroupStore();

    const [groupId] = await store.convertImageToLabelmap(
      'child-img',
      'parent-img'
    );

    expect(store.metadataByID[groupId].segments.order).toEqual([]);
    expect(Object.keys(store.metadataByID[groupId].segments.byValue)).toEqual(
      []
    );
  });
});
