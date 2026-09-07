import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { makeSpecImage } from '@/src/store/__tests__/segmentMaskFixtures';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';
import { useImageCacheStore } from '@/src/store/image-cache';
import { leafStateId } from '@/src/io/import/dataSource';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { migrateManifest } from '@/src/io/state-file/migrations';

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

// eslint-disable-next-line no-restricted-syntax -- ITK-wasm image IO has no counterpart in the node test environment
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

/** The plain 4x4x4 parent every restore in this spec hangs off. */
const makeParentImage = () => makeSpecImage();

// A parent-bound, descriptor-less group: metadata carries name + parentImage,
// NO segments. The migration turns it into an artifact marked `pendingDecode`,
// and the LOADED restore stage is what enumerates its voxels.
const migrated = (manifest: Record<string, unknown>): Manifest =>
  ManifestSchema.parse(migrateManifest(JSON.stringify(manifest)));

const descriptorlessComposedManifest = (visibility = true) =>
  migrated({
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
    viewByID: {
      Axial: {
        id: 'Axial',
        name: 'Axial',
        type: '2D',
        config: {
          'sg-tumor': {
            layers: {
              colorBy: { arrayName: '', location: 'pointData' },
              transferFunction: { preset: '', mappingRange: [0, 1] },
              opacityFunction: {
                mode: 0,
                gaussians: [],
                mappingRange: [0, 1],
              },
              blendConfig: { opacity: 0.4, visibility },
            },
            segmentGroup: { outlineOpacity: 0.25, outlineThickness: 5 },
          },
        },
      },
    },
    segmentGroups: [
      {
        id: 'sg-tumor',
        dataSourceId: 3,
        metadata: { name: 'Tumor', parentImage: 'ds-ct' },
      },
    ],
  });

const descriptorlessArchiveManifest = () =>
  migrated({
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

// The catalog now lives in the segmentation store: the image's segments, in
// segmentation order. Identity is a stable id, so parity compares the
// descriptive fields plus the label value the binding carries.
const catalogFor = (parentImageId: string) => {
  const segmentation =
    useSegmentationStore().getSegmentationForImage(parentImageId);
  if (!segmentation) return [];
  return segmentation.order
    .map((id) => segmentation.masks[id])
    .map((segment) => {
      const appearance = useSegmentStore().segments.appearanceOf(
        segment.segmentId
      );
      return {
        name: appearance.name,
        color: [...appearance.color],
        visible: appearance.visible,
        locked: appearance.locked,
        labelValue: segment.representations.labelmap!.labelValue,
      };
    });
};

// The LIVE path: what convertImageToLabelmap builds for this labelmap.
async function liveCatalog(segmentMetadata?: Map<string, string>) {
  setActivePinia(createPinia());
  seat('parent-img', 'CT Chest', makeParentImage());
  seat('child-img', 'Tumor.seg.nrrd', makeLabelmapImage(), segmentMetadata);
  const store = useSegmentationStore();
  await store.convertImageToLabelmap('child-img', 'parent-img');
  return catalogFor('parent-img');
}

// The COLD path: what the loaded restore stage builds from a descriptor-less
// composed manifest whose artifact materialized as a loaded dataset.
async function coldCatalog(
  segmentMetadata?: Map<string, string>,
  visibility = true
) {
  setActivePinia(createPinia());
  seat('parent-store', 'CT Chest', makeParentImage());
  seat(
    'artifact-store',
    'Tumor.seg.nrrd',
    makeLabelmapImage(),
    segmentMetadata
  );
  await completeStateFileRestore(
    descriptorlessComposedManifest(visibility),
    [],
    {
      'ds-ct': 'parent-store',
      [leafStateId(3)]: 'artifact-store',
    }
  );
  return catalogFor('parent-store');
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
    expect(live.map((segment) => segment.labelValue)).toEqual([1, 2]);
    expect(live.map((segment) => segment.name)).toEqual(['Tumor 1', 'Tumor 2']);

    expect(cold).toEqual(live);
  });

  it('applies legacy display state after decoding the segment catalog', async () => {
    await coldCatalog(undefined, false);

    const segmentation =
      useSegmentationStore().getSegmentationForImage('parent-store')!;
    const registry = useSegmentStore().segments;
    const masks = segmentation.order.map((id) => segmentation.masks[id]);
    // Fill renders as the product of the segment's share and the image's
    // multiplier, and 0.4 is what the legacy group showed.
    expect(
      masks.map(
        (segment) =>
          registry.appearanceOf(segment.segmentId).fillOpacity *
          segmentation.fillOpacity
      )
    ).toEqual([0.4, 0.4]);
    expect(
      masks.map(
        (segment) => registry.appearanceOf(segment.segmentId).outlineOpacity
      )
    ).toEqual([0.25, 0.25]);
    expect(
      masks.map((segment) => registry.appearanceOf(segment.segmentId).visible)
    ).toEqual([false, false]);
    expect(segmentation.outlineThickness).toBe(5);
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
    const named = (labelValue: number) =>
      live.find((segment) => segment.labelValue === labelValue)?.name;
    expect(named(2)).toBe('Tumor core');
    expect(named(1)).toBe('Tumor 1');

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

    await completeStateFileRestore(
      descriptorlessArchiveManifest(),
      [
        {
          archivePath: 'segmentations/Tumor.seg.nrrd',
          file: new File([''], 'Tumor.seg.nrrd'),
        },
      ],
      { 'ds-ct': 'parent-store' }
    );

    const catalog = catalogFor('parent-store');
    expect(catalog.map((entry) => entry.labelValue)).toEqual([1, 2]);
    expect(catalog[0].name).toBe('Segment 1');
    expect(catalog[1]).toMatchObject({
      name: 'Tumor core',
      color: [255, 0, 0, 255],
    });
  });

  it('enumerates only distinct sparse voxel labels', async () => {
    setActivePinia(createPinia());
    seat('parent-img', 'CT Chest', makeParentImage());
    seat('child-img', 'Sparse.seg.nrrd', makeSparseLabelmapImage());
    const store = useSegmentationStore();

    await store.convertImageToLabelmap('child-img', 'parent-img');

    expect(
      catalogFor('parent-img').map((segment) => segment.labelValue)
    ).toEqual([1, 255]);
  });

  it('enumerates no segments for an all-background labelmap', async () => {
    setActivePinia(createPinia());
    seat('parent-img', 'CT Chest', makeParentImage());
    // Every voxel is LABELMAP_BACKGROUND_VALUE (0): an all-background labelmap
    // built with the same all-zero image helper the parent uses. Distinct
    // nonzero labels are enumerated, so this labelmap has none.
    seat('child-img', 'Empty.seg.nrrd', makeParentImage());
    const store = useSegmentationStore();

    await store.convertImageToLabelmap('child-img', 'parent-img');

    expect(catalogFor('parent-img')).toEqual([]);
    expect(Object.keys(useSegmentationStore().artifactMeta)).toEqual([]);
  });
});
