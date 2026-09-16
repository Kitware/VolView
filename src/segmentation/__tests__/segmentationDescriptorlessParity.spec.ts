import { describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import {
  legacyAxialViewConfig,
  makeImage,
  seatImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
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

const BASE_URI = 'volview-backend:base/ct-chest-001';
const ARTIFACT_URI = 'volview-backend:artifact/tumor-seg/v2';

// Voxel values {0, 1, 2}: background plus two segments.
const labelValues = () => new Uint8Array(4 * 4 * 4).fill(1, 20, 44).fill(2, 44);

// A parent-bound, descriptor-less group: metadata carries name + parentImage,
// NO segments. The migration turns it into an artifact no mask names, and the
// LOADED restore stage is what enumerates its voxels.
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
    viewByID: legacyAxialViewConfig('sg-tumor', visibility),
    segmentGroups: [
      {
        id: 'sg-tumor',
        dataSourceId: 3,
        metadata: { name: 'Tumor', parentImage: 'ds-ct' },
      },
    ],
  });

const descriptorlessArchiveManifest = (name: string) =>
  migrated({
    version: '6.4.0',
    dataSources: [{ id: 1, type: 'uri', uri: BASE_URI, name: 'CT Chest' }],
    datasets: [{ id: 'ds-ct', dataSourceId: 1 }],
    segmentGroups: [
      {
        id: 'sg-tumor',
        path: 'segmentations/Tumor.seg.nrrd',
        metadata: { name, parentImage: 'ds-ct' },
      },
    ],
  });

// The image's segments in mask order, compared by appearance.
const catalogFor = (parentImageId: string) => {
  const segmentation =
    useSegmentationStore().getSegmentationForImage(parentImageId);
  if (!segmentation) return [];
  return segmentation.order
    .map((id) => segmentation.masks[id])
    .map((mask) => {
      const appearance = useSegmentStore().segments.appearanceOf(
        mask.segmentId
      );
      return {
        name: appearance.name,
        color: [...appearance.color],
        visible: appearance.visible,
        locked: appearance.locked,
      };
    });
};

// A descriptor-less group saved in the archive, restored with no loaded
// dataset to take a name from.
async function archiveCatalog(
  groupName: string,
  decoded: { image: vtkImageData; headerMetadata?: Map<string, string> }
) {
  setActivePinia(createPinia());
  await seatImage('parent-store', { name: 'CT Chest' });
  const store = useSegmentationStore();
  const deserialize = store.deserialize;
  const read = vi.spyOn(store, 'deserialize').mockImplementation((options) =>
    deserialize({
      ...options,
      io: { read: async () => decoded, write: vi.fn() },
    })
  );

  try {
    await completeStateFileRestore(
      descriptorlessArchiveManifest(groupName),
      [
        {
          archivePath: 'segmentations/Tumor.seg.nrrd',
          file: new File([''], 'Tumor.seg.nrrd'),
        },
      ],
      { 'ds-ct': 'parent-store' }
    );
  } finally {
    read.mockRestore();
  }
  return catalogFor('parent-store');
}

// The LIVE path: what convertImageToLabelmap builds for this labelmap.
async function liveCatalog(segmentMetadata?: Map<string, string>) {
  setActivePinia(createPinia());
  await seatImage('parent-img', { name: 'CT Chest' });
  await seatImage('child-img', {
    name: 'Tumor.seg.nrrd',
    values: labelValues(),
    headerMetadata: segmentMetadata,
  });
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
  await seatImage('parent-store', { name: 'CT Chest' });
  await seatImage('artifact-store', {
    name: 'Tumor.seg.nrrd',
    values: labelValues(),
    headerMetadata: segmentMetadata,
  });
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
  it('defaults-only labelmap: identical enumeration, names, and colors', async () => {
    const live = await liveCatalog();
    const cold = await coldCatalog();

    // Sanity on the live shape: the full non-background enumeration got
    // default names/colors — not an empty catalog.
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
        (mask) =>
          registry.appearanceOf(mask.segmentId).fillOpacity *
          segmentation.fillOpacity
      )
    ).toEqual([0.4, 0.4]);
    expect(
      masks.map((mask) => registry.appearanceOf(mask.segmentId).outlineOpacity)
    ).toEqual([0.25, 0.25]);
    expect(
      masks.map((mask) => registry.appearanceOf(mask.segmentId).visible)
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
    // The split walks the source values in ascending order, so a segment's
    // place in the catalog says which value it came from.
    expect(live.map((segment) => segment.name)).toEqual([
      'Tumor 1',
      'Tumor core',
    ]);

    expect(cold).toEqual(live);
  });

  it('preserves embedded metadata from an archive-backed .seg.nrrd', async () => {
    const decoded = {
      image: makeImage({ values: labelValues() }),
      headerMetadata: new Map<string, string>([
        ['Segment0_LabelValue', '2'],
        ['Segment0_Name', 'Tumor core'],
        ['Segment0_Color', '1 0 0'],
      ]),
    };

    const catalog = await archiveCatalog('Tumor', decoded);
    expect(catalog).toHaveLength(2);
    expect(catalog[1]).toMatchObject({
      name: 'Tumor core',
      color: [255, 0, 0, 255],
    });
    // Bytes read straight from the archive have no loaded dataset to take a
    // name from, and 'Segment 1' says nothing about what was restored: the
    // undescribed value is named after the labelmap, as the live conversion
    // names it after the file it arrived in.
    expect(catalog).toEqual(await liveCatalog(decoded.headerMetadata));
  });

  it('names archive segments after the whole group name, not a path tail', async () => {
    const name = 'Tumor W/O CONTRAST 2.5mm';
    const catalog = await archiveCatalog(name, {
      image: makeImage({ values: labelValues() }),
    });

    expect(catalog.map((segment) => segment.name)).toEqual([
      `${name} 1`,
      `${name} 2`,
    ]);
  });

  it('enumerates only distinct sparse voxel labels', async () => {
    setActivePinia(createPinia());
    await seatImage('parent-img', { name: 'CT Chest' });
    await seatImage('child-img', {
      name: 'Sparse.seg.nrrd',
      values: new Uint8Array(4 * 4 * 4).fill(1, 8, 16).fill(255, 48),
    });
    const store = useSegmentationStore();

    await store.convertImageToLabelmap('child-img', 'parent-img');

    // Two distinct nonzero labels in the file, so two segments, named after
    // the values they carried in it.
    expect(catalogFor('parent-img').map((segment) => segment.name)).toEqual([
      'Sparse 1',
      'Sparse 255',
    ]);
  });
});
