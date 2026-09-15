import { expect } from 'vitest';
import { nextTick } from 'vue';
import JSZip from 'jszip';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { TypedArray } from '@kitware/vtk.js/types';
import type vtkLabelMap from '@/src/vtk/LabelMap';

import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  useSegmentationStore,
  type LabelmapIO,
} from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { listMasks } from '@/src/segmentation/model';
import { type Extent3D } from '@/src/segmentation/geometry';
import type { SegmentInit } from '@/src/segmentation/segment';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

/** A point in the PARENT image's index space, which is where extents live. */
export type Index3 = [number, number, number];

export const store = () => useSegmentationStore();

export const voxelCount = (dimensions: Index3) =>
  dimensions[0] * dimensions[1] * dimensions[2];

/** The offset an index lands at in a buffer shaped like `dimensions`. */
export const flatIndex =
  (dimensions: Index3) => (i: number, j: number, k: number) =>
    i + j * dimensions[0] + k * dimensions[0] * dimensions[1];

export type SeatOptions = {
  name?: string;
  dimensions?: Index3;
  spacing?: [number, number, number];
  origin?: [number, number, number];
  values?: TypedArray;
};

export async function seatImage(id: string, options: SeatOptions = {}) {
  const {
    name = id,
    dimensions = [4, 4, 4] as Index3,
    spacing = [1, 1, 1],
    origin = [0, 0, 0],
    values,
  } = options;

  const image = vtkImageData.newInstance({ spacing, origin });
  image.setDimensions(dimensions);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: values ?? new Uint8Array(voxelCount(dimensions)),
    })
  );
  image.computeTransforms();
  useImageCacheStore().addVTKImageData(image, name, { id });
  await nextTick();
  return image;
}

/** The parent shape segmentation specs seat: thin in k, so extents read easily. */
export const SPEC_DIMENSIONS: Index3 = [4, 4, 2];
export const SPEC_VOXEL_COUNT = voxelCount(SPEC_DIMENSIONS);
export const SPEC_FULL_EXTENT: Extent3D = [0, 3, 0, 3, 0, 1];

/** An accessor as far as the extent contract is concerned. */
type ExtentAccessor = { ensureContains: (extent: Extent3D) => boolean };

const scalarsOf = (labelmap: vtkImageData) =>
  labelmap.getPointData().getScalars().getData();

/** Growing to an extent the storage already covers invalidates nothing. */
export const expectCoveredExtentIsNoop = (
  voxels: ExtentAccessor,
  labelmap: vtkImageData
) => {
  const scalars = scalarsOf(labelmap);
  const before = labelmap.getMTime();

  expect(voxels.ensureContains([1, 2, 1, 2, 0, 1])).toBe(false);
  expect(voxels.ensureContains(SPEC_FULL_EXTENT)).toBe(false);

  expect(scalarsOf(labelmap)).toBe(scalars);
  expect(labelmap.getDimensions()).toEqual([...SPEC_DIMENSIONS]);
  expect(labelmap.getMTime()).toBe(before);
};

/** Growing past the parent image is refused, and changes nothing. */
export const expectExtentPastParentThrows = (
  voxels: ExtentAccessor,
  labelmap: vtkImageData
) => {
  expect(() => voxels.ensureContains([0, 4, 0, 3, 0, 1])).toThrow();
  expect(() => voxels.ensureContains([-1, 3, 0, 3, 0, 1])).toThrow();
  expect(labelmap.getDimensions()).toEqual([...SPEC_DIMENSIONS]);
};

/** Seats a spec-shaped parent image and hands back its id. */
export const seatSpecImage = async (id: string, name = 'CT') => {
  await seatImage(id, { name, dimensions: SPEC_DIMENSIONS });
  return id;
};

/**
 * itk-wasm image IO has no node counterpart, so this keeps the labelmap in
 * memory and hands the archive a token that reads back to it. `written` and
 * `formats` record the write calls in order.
 */
export const inMemoryArtifactIO = () => {
  const labelmaps = new Map<string, vtkLabelMap>();
  const written: vtkLabelMap[] = [];
  const formats: string[] = [];
  return {
    written,
    formats,
    write: async (format: string, labelmap: vtkLabelMap) => {
      const token = `labelmap-${labelmaps.size}`;
      labelmaps.set(token, labelmap);
      written.push(labelmap);
      formats.push(format);
      return token;
    },
    read: async (file: File) => ({ image: labelmaps.get(await file.text())! }),
  };
};

/** Everything a round trip or a migration has to preserve for one image. */
export const segmentationSnapshot = (imageId: string) => {
  const segments = useSegmentStore().segments;
  const segmentation = store().getSegmentationForImage(imageId)!;
  const selectedSegmentId = segments.selectedSegmentId.value;
  return {
    name: segmentation.name,
    segments: segmentation.order.map((maskId) => {
      const mask = segmentation.masks[maskId];
      const binding = mask.representations.labelmap;
      const appearance = segments.appearanceOf(mask.segmentId);
      return {
        name: appearance.name,
        color: [...appearance.color],
        visible: appearance.visible,
        locked: appearance.locked,
        fillOpacity: appearance.fillOpacity,
        outlineOpacity: appearance.outlineOpacity,
        binding: binding && {
          extent: [...binding.extent],
          name: binding.name,
          artifactSource: binding.source,
        },
      };
    }),
    selectedTypeName: selectedSegmentId
      ? segments.appearanceOf(selectedSegmentId).name
      : undefined,
    display: {
      fillOpacity: segmentation.fillOpacity,
      outlineOpacity: segmentation.outlineOpacity,
      outlineThickness: segmentation.outlineThickness,
    },
  };
};

/** The 6.4.0 axial view config a group's display rode in, before 7.0.0. */
export const legacyAxialViewConfig = (groupId: string, visibility = true) => ({
  Axial: {
    id: 'Axial',
    name: 'Axial',
    type: '2D',
    config: {
      [groupId]: {
        layers: {
          colorBy: { arrayName: '', location: 'pointData' },
          transferFunction: { preset: '', mappingRange: [0, 1] },
          opacityFunction: { mode: 0, gaussians: [], mappingRange: [0, 1] },
          blendConfig: { opacity: 0.4, visibility },
        },
        segmentGroup: { outlineOpacity: 0.25, outlineThickness: 5 },
      },
    },
  },
});

/** A manifest naming one dataset and one uri source per seated image. */
export const manifestForImages = (
  imageIds: string[],
  extra: Record<string, unknown> = {}
) =>
  ({
    version: MANIFEST_VERSION,
    datasets: imageIds.map((id, index) => ({ id, dataSourceId: index + 1 })),
    dataSources: imageIds.map((id, index) => ({
      id: index + 1,
      type: 'uri',
      uri: `/${id}.nrrd`,
    })),
    datasetFilePath: {},
    ...extra,
  }) as unknown as Manifest;

/** Every archive path the parsed manifest names, artifacts and masks alike. */
const archivePathsIn = (parsed: any): string[] => [
  ...(parsed.segmentationArtifacts ?? []).flatMap((artifact: any) =>
    artifact.path ? [artifact.path] : []
  ),
  ...parsed.segmentations.flatMap((segmentation: any) =>
    segmentation.masks.flatMap((mask: any) => {
      const path = mask.representations.labelmap?.path;
      return path ? [path] : [];
    })
  ),
];

/** Serializes the live scene, then reads its labelmaps back as state files. */
export const serializeToStateFiles = async (
  manifest: Manifest,
  io: LabelmapIO,
  tamper?: (parsed: any) => void
) => {
  const zip = new JSZip();
  useSegmentStore().serialize({ zip, manifest });
  await store().serialize({ zip, manifest }, io);
  const parsed = ManifestSchema.parse(manifest) as any;
  tamper?.(parsed);
  const stateFiles = await Promise.all(
    archivePathsIn(parsed).map(async (path) => ({
      archivePath: path,
      file: new File([await zip.file(path)!.async('string')], 'artifact.vti'),
    }))
  );
  return { zip, parsed, stateFiles };
};

/** A plain 4x4x4 image, uncached: the shape most restore specs parent onto. */
export const makeSpecImage = () => {
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
};

export const parentImage = (imageId: string) =>
  useImageCacheStore().getVtkImageData(imageId)!;

/** A type minted straight into the shared registry, named or not. */
export const mintSegment = (init: SegmentInit | string = {}) =>
  useSegmentStore().segments.mintSegment(
    typeof init === 'string' ? { name: init } : init
  );

/** A record with no storage: adding one never allocates voxels. */
export function addMask(imageId: string, name?: string) {
  const segmentation = store().ensureSegmentationForImage(imageId);
  return store().createMask(segmentation.id, mintSegment(name)).id;
}

/** This image's record for a type, created without changing the selection. */
export const maskOn = (imageId: string, segmentId: string) =>
  store().getMask(store().resolveEditTarget(imageId, segmentId));

/** The type a record delineates. */
export const segmentOfMask = (maskId: string) =>
  store().getMask(maskId).segmentId;

/** Locks the type a record delineates, which is what refuses an edit. */
export const lockSegment = (maskId: string, locked = true) =>
  useSegmentStore().segments.updateSegment(segmentOfMask(maskId), { locked });

/** Selects the type a record delineates, which is what an edit targets. */
export const selectSegment = (maskId: string) =>
  useSegmentStore().segments.selectSegment(store().getMask(maskId).segmentId);

/** Seats one segment, grown across `values`, and makes it active. */
export function addActiveSegment(
  values = new Uint8Array([0, 0]),
  labelValue = 1,
  imageId = 'image-1'
) {
  const segmentationStore = useSegmentationStore();
  const segmentation = segmentationStore.ensureSegmentationForImage(imageId);
  // Label values are minted per image, so the ones below the wanted value are
  // taken by placeholder segments.
  for (let value = 1; value < labelValue; value += 1) {
    const filler = segmentationStore.createMask(
      segmentation.id,
      mintSegment({
        name: `Filler ${value}`,
      })
    );
    segmentationStore.maskVoxels(filler.id).materialize();
  }

  const segment = segmentationStore.createMask(
    segmentation.id,
    mintSegment({
      name: 'Segment 1',
    })
  );
  const voxels = segmentationStore.maskVoxels(segment.id);
  voxels.materialize();
  voxels.ensureContains([0, values.length - 1, 0, 0, 0, 0]);
  voxels.apply(values);
  selectSegment(segment.id);

  return {
    segmentationId: segmentation.id,
    maskId: segment.id,
    labelMap: voxels.image(),
  };
}

/** The record an edit on this image would land in, without creating one. */
export const selectedSegmentOn = (imageId: string) =>
  store().findEditTarget(imageId);

/** Every mask in the scene that holds voxels, whatever image it sits on. */
export const boundMasks = () =>
  Object.values(store().segmentations).flatMap((segmentation) =>
    listMasks(segmentation).filter(
      (segment) => segment.representations.labelmap
    )
  );

/** The buffer a mask's voxels live in, which is its storage identity. */
export const storageOf = (maskId: string) => bindingOf(maskId)?.image;

export const bindingOf = (maskId: string) =>
  store().maskVoxels(maskId).binding();

export const extentOf = (maskId: string) => bindingOf(maskId)?.extent;

/** The value a bound mask marks its voxels with; undefined when unbound. */
export const labelValueOf = (maskId: string) =>
  bindingOf(maskId) && SEGMENT_VALUE;

const containsIndex = (extent: Extent3D, [i, j, k]: Index3) =>
  i >= extent[0] &&
  i <= extent[1] &&
  j >= extent[2] &&
  j <= extent[3] &&
  k >= extent[4] &&
  k <= extent[5];

/** The mask offset a parent index maps to, or undefined when it is outside. */
export function offsetOf(maskId: string, index: Index3) {
  const binding = bindingOf(maskId);
  if (!binding || !containsIndex(binding.extent, index)) return undefined;
  const dimensions = store().maskVoxels(maskId).image().getDimensions();
  const { extent } = binding;
  return (
    index[0] -
    extent[0] +
    (index[1] - extent[2]) * dimensions[0] +
    (index[2] - extent[4]) * dimensions[0] * dimensions[1]
  );
}

/**
 * The segment's voxel value at a PARENT index, or undefined when that index is
 * outside the mask. Reads through the binding's extent, so it says the same
 * thing whatever the mask's own bounds are.
 */
export function maskValueAt(maskId: string, index: Index3) {
  const offset = offsetOf(maskId, index);
  if (offset === undefined) return undefined;
  return store().maskVoxels(maskId).scalars()[offset];
}

/** Marks one parent-index voxel for a segment, through the growth path. */
export function seedVoxel(maskId: string, index: Index3, value?: number) {
  const voxels = store().maskVoxels(maskId);
  voxels.materialize();
  voxels.ensureContains([
    index[0],
    index[0],
    index[1],
    index[1],
    index[2],
    index[2],
  ]);
  const offset = offsetOf(maskId, index)!;
  voxels.scalars()[offset] = value ?? SEGMENT_VALUE;
  voxels.image().modified();
}

/**
 * Every marked voxel of a segment as `[i, j, k, value]` in PARENT index space,
 * so two masks with different bounds are still comparable.
 */
export function markedVoxels(maskId: string) {
  const binding = bindingOf(maskId);
  if (!binding) return undefined;
  const voxels = store().maskVoxels(maskId);
  const [di, dj, dk] = voxels.image().getDimensions();
  const scalars = voxels.scalars();
  const marks: Array<[number, number, number, number]> = [];
  for (let k = 0; k < dk; k += 1) {
    for (let j = 0; j < dj; j += 1) {
      for (let i = 0; i < di; i += 1) {
        const value = scalars[i + j * di + k * di * dj];
        if (value !== 0) {
          marks.push([
            i + binding.extent[0],
            j + binding.extent[2],
            k + binding.extent[4],
            value,
          ]);
        }
      }
    }
  }
  return marks;
}
