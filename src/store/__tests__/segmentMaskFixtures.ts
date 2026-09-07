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
  type SegmentationArtifactIO,
} from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';
import type { Extent3D } from '@/src/types/segmentation';
import type { SegmentInit } from '@/src/types/segment';

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

/** Serializes the live scene, then reads its artifacts back as state files. */
export const serializeToStateFiles = async (
  manifest: Manifest,
  io: SegmentationArtifactIO,
  tamper?: (parsed: any) => void
) => {
  const zip = new JSZip();
  useSegmentStore().serialize({ zip, manifest });
  await store().serialize({ zip, manifest }, io);
  const parsed = ManifestSchema.parse(manifest) as any;
  tamper?.(parsed);
  const stateFiles = await Promise.all(
    parsed.segmentationArtifacts.map(async (artifact: any) => ({
      archivePath: artifact.path,
      file: new File(
        [await zip.file(artifact.path)!.async('string')],
        'artifact.vti'
      ),
    }))
  );
  return { zip, parsed, stateFiles };
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

/** The record an edit on this image would land in, without creating one. */
export const selectedSegmentOn = (imageId: string) =>
  store().findEditTarget(imageId);

export const bindingOf = (maskId: string) =>
  store().maskVoxels(maskId).binding();

export const extentOf = (maskId: string) => bindingOf(maskId)?.extent;

export const labelValueOf = (maskId: string) => bindingOf(maskId)?.labelValue;

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
  const binding = voxels.materialize();
  voxels.ensureContains([
    index[0],
    index[0],
    index[1],
    index[1],
    index[2],
    index[2],
  ]);
  const offset = offsetOf(maskId, index)!;
  voxels.scalars()[offset] = value ?? binding.labelValue;
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
