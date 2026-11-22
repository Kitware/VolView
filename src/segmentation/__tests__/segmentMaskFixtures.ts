import { expect } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import JSZip from 'jszip';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { TypedArray } from '@kitware/vtk.js/types';
import vtkLabelMap from '@/src/vtk/LabelMap';

import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';
import { useImageCacheStore } from '@/src/store/image-cache';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useViewStore } from '@/src/store/views';
import { useSegmentationStore } from '@/src/segmentation/store';
import {
  serializeSegmentation,
  type LabelmapIO,
} from '@/src/segmentation/io/stateFile';
import { useSegmentStore } from '@/src/segmentation/segments';
import { type Extent3D } from '@/src/segmentation/geometry';
import type { SegmentInit } from '@/src/segmentation/segment';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import {
  captureLabelmapParts,
  composeLabelmapPart,
} from '@/src/segmentation/io/composition';
import type { SegmentMaskEntry } from '@/src/segmentation/model';
import { omit } from '@/src/utils';

/** A point in the PARENT image's index space, which is where extents live. */
export type Index3 = [number, number, number];

export const store = () => useSegmentationStore();

/** A pinia installed on an app, since the stores inject the app's providers. */
export const activateAppPinia = () => {
  const pinia = createPinia().use(CorePiniaProviderPlugin());
  createApp({}).use(pinia);
  setActivePinia(pinia);
  return pinia;
};

export const voxelCount = (dimensions: Index3) =>
  dimensions[0] * dimensions[1] * dimensions[2];

export const flatIndex =
  (dimensions: Index3) => (i: number, j: number, k: number) =>
    i + j * dimensions[0] + k * dimensions[0] * dimensions[1];

export type ImageOptions = {
  dimensions?: Index3;
  spacing?: [number, number, number];
  origin?: [number, number, number];
  values?: TypedArray;
  components?: number;
};

export type SeatOptions = ImageOptions & {
  name?: string;
  headerMetadata?: Map<string, string>;
};

const shapeImage = <T extends vtkImageData>(
  image: T,
  {
    dimensions = [4, 4, 4],
    spacing = [1, 1, 1],
    origin = [0, 0, 0],
    values,
    components = 1,
  }: ImageOptions
) => {
  image.setSpacing(spacing);
  image.setOrigin(origin);
  image.setDimensions(dimensions);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: components,
      values: values ?? new Uint8Array(voxelCount(dimensions) * components),
    })
  );
  image.computeTransforms();
  return image;
};

/** An uncached image, 4x4x4 zeros unless told otherwise. */
export const makeImage = (options: ImageOptions = {}) =>
  shapeImage(vtkImageData.newInstance(), options);

/** A cached 4x4x4 image holding label 1 in its first voxel. */
export const cacheLabelledImage = (id: string, name: string) => {
  const values = new Uint8Array(voxelCount([4, 4, 4]));
  values[0] = 1;
  return useImageCacheStore().addVTKImageData(makeImage({ values }), name, {
    id,
  });
};

/** The same image as a labelmap, the type a split takes. */
export const makeLabelmap = (options: ImageOptions = {}) =>
  shapeImage(vtkLabelMap.newInstance(), options);

/** Scalars holding each mark's value at its voxel, 16-bit past the byte limit. */
export function labelmapValues(
  dimensions: Index3,
  marks: Array<{ value: number; at: Index3 }>
) {
  const Scalars = marks.some(({ value }) => value > 255)
    ? Uint16Array
    : Uint8Array;
  const values = new Scalars(voxelCount(dimensions));
  const offset = flatIndex(dimensions);
  marks.forEach(({ value, at }) => {
    values[offset(...at)] = value;
  });
  return values;
}

export async function seatImage(id: string, options: SeatOptions = {}) {
  const { name = id, headerMetadata, ...shape } = options;
  const image = makeImage(shape);
  useImageCacheStore().addVTKImageData(image, name, { id, headerMetadata });
  await nextTick();
  return image;
}

export async function showImage(id: string) {
  useViewStore().setDataForAllViews(id);
  await nextTick();
}

/** Seats an image and shows it in every view, which makes it the current one. */
export async function viewImage(id: string, options: SeatOptions = {}) {
  const image = await seatImage(id, options);
  await showImage(id);
  return image;
}

/** The parent shape segmentation specs seat: thin in k, so extents read easily. */
export const SPEC_DIMENSIONS: Index3 = [4, 4, 2];
export const SPEC_VOXEL_COUNT = voxelCount(SPEC_DIMENSIONS);
export const SPEC_FULL_EXTENT: Extent3D = [0, 3, 0, 3, 0, 1];

type ExtentAccessor = { ensureContains: (extent: Extent3D) => boolean };

const scalarsOf = (labelmap: vtkImageData) =>
  labelmap.getPointData().getScalars().getData();

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

export const expectExtentPastParentThrows = (
  voxels: ExtentAccessor,
  labelmap: vtkImageData
) => {
  expect(() => voxels.ensureContains([0, 4, 0, 3, 0, 1])).toThrow();
  expect(() => voxels.ensureContains([-1, 3, 0, 3, 0, 1])).toThrow();
  expect(labelmap.getDimensions()).toEqual([...SPEC_DIMENSIONS]);
};

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
  const snapshots: Array<{ dimensions: number[]; values: number[] }> = [];
  return {
    written,
    formats,
    snapshots,
    write: async (format: string, labelmap: vtkLabelMap) => {
      const token = `labelmap-${labelmaps.size}`;
      labelmaps.set(token, labelmap);
      written.push(labelmap);
      snapshots.push({
        dimensions: [...labelmap.getDimensions()],
        values: Array.from(scalarsOf(labelmap)),
      });
      formats.push(format);
      return token;
    },
    read: async (file: File) => ({ image: labelmaps.get(await file.text())! }),
  };
};

export const segmentationSnapshot = (imageId: string) => {
  const segments = useSegmentStore().segments;
  const selectedSegmentId = segments.selectedSegmentId(imageId);
  const display = segments.displayOf(imageId);
  return {
    name: store().segmentationName(imageId),
    segments: segments.imageMasks(imageId).map(({ segmentId, binding }) => {
      const appearance = segments.appearanceOf(segmentId);
      return {
        name: appearance.name,
        color: [...appearance.color],
        visible: appearance.visible,
        locked: appearance.locked,
        fillOpacity: appearance.fillOpacity,
        outlineOpacity: appearance.outlineOpacity,
        binding: binding && {
          extent: [...binding.extent],
          source: binding.source,
        },
      };
    }),
    selectedSegmentName: selectedSegmentId
      ? segments.appearanceOf(selectedSegmentId).name
      : undefined,
    display: {
      fillOpacity: display.fillOpacity,
      outlineOpacity: display.outlineOpacity,
      outlineThickness: display.outlineThickness,
    },
  };
};

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

export const serializeAnnotations = (
  manifest = manifestForImages(useImageCacheStore().imageIds, { tools: {} })
) => {
  const state = { zip: new JSZip(), manifest };
  useSegmentStore().serialize(state);
  useRulerStore().serialize(state);
  useRectangleStore().serialize(state);
  usePolygonStore().serialize(state);
  return JSON.parse(JSON.stringify(manifest)) as Manifest;
};

export const savedSegmentNames = (
  imageId: string,
  manifest = serializeAnnotations()
) => {
  const entry = manifest.imageSegments?.find(
    (candidate) => candidate.imageId === imageId
  );
  return (entry?.segments ?? []).map(({ name }) => name);
};

/** Every saved segment across images, without its mask. */
export const savedSegments = (manifest: Manifest) =>
  (manifest.imageSegments ?? []).flatMap(({ segments }) =>
    segments.map((segment) => omit(segment, 'labelmap'))
  );

/** Every saved mask with its image and segment. */
export const savedLabelmaps = (manifest: Manifest) =>
  (manifest.imageSegments ?? []).flatMap(({ imageId, segments }) =>
    segments.flatMap(({ id, labelmap }) =>
      labelmap ? [{ imageId, segmentId: id, labelmap }] : []
    )
  );

const archivePathsIn = (parsed: any): string[] => [
  ...(parsed.segmentationArtifacts ?? []).flatMap((artifact: any) =>
    artifact.path ? [artifact.path] : []
  ),
  ...(parsed.imageSegments ?? []).flatMap((entry: any) =>
    entry.segments.flatMap((segment: any) => {
      const path = segment.labelmap?.path;
      return path ? [path] : [];
    })
  ),
];

export const stateFilesOf = (zip: JSZip, parsed: any) =>
  Promise.all(
    archivePathsIn(parsed).map(async (path) => ({
      archivePath: path,
      file: new File([await zip.file(path)!.async('string')], 'artifact.vti'),
    }))
  );

export const serializeToStateFiles = async (
  manifest: Manifest,
  io: LabelmapIO,
  tamper?: (parsed: any) => void
) => {
  const zip = new JSZip();
  await serializeSegmentation({ zip, manifest }, io);
  const parsed = ManifestSchema.parse(manifest) as any;
  tamper?.(parsed);
  const stateFiles = await stateFilesOf(zip, parsed);
  return { zip, parsed, stateFiles };
};

/** A plain 4x4x4 image, uncached: the shape most restore specs parent onto. */
export const makeSpecImage = () => makeImage();

export const parentImage = (imageId: string) =>
  useImageCacheStore().getVtkImageData(imageId)!;

/** An image's segment names, in its own order. */
export const segmentNames = (imageId: string) =>
  useSegmentStore()
    .segments.segmentList(imageId)
    .map(({ name }) => name);

export const maskedSegmentIds = (imageId: string) =>
  useSegmentStore()
    .segments.imageMasks(imageId)
    .map(({ segmentId }) => segmentId);

export const mintSegment = (imageId: string, init: SegmentInit | string = {}) =>
  useSegmentStore().segments.mintSegment(
    imageId,
    typeof init === 'string' ? { name: init } : init
  );

/** A segment with no mask: adding one never allocates voxels. */
export const addSegment = (imageId: string, name?: string) =>
  mintSegment(imageId, name);

/** Segments whose masks each hold the first voxel. */
export const bindMasks = (imageId: string, names: string[]) =>
  names.map((name) => {
    const segmentId = addSegment(imageId, name);
    seedVoxel(segmentId, [0, 0, 0]);
    return segmentId;
  });

/** Deletes a segment the way the user does, its mask with it. */
export const deleteSegment = (segmentId: string) =>
  useSegmentStore().segments.deleteSegment(segmentId);

export const lockSegment = (segmentId: string, locked = true) =>
  useSegmentStore().segments.updateSegment(segmentId, { locked });

export const selectSegment = (segmentId: string) =>
  useSegmentStore().segments.selectSegment(segmentId);

/** A stroke on the K axis; unit spacing makes world points index points. */
export function strokeAt(
  imageId: string,
  from: Index3,
  to = from,
  brushSize = 1
) {
  const paintStore = usePaintToolStore();
  paintStore.setBrushSize(brushSize);
  paintStore.startStroke(from, 2, imageId);
  paintStore.endStroke(to, 2, imageId);
}

export function addActiveSegment(
  values = new Uint8Array([0, 0]),
  imageId = 'image-1'
) {
  const segmentationStore = useSegmentationStore();
  const segmentId = mintSegment(imageId, { name: 'Segment 1' });
  const voxels = segmentationStore.maskVoxels(segmentId);
  voxels.materialize();
  voxels.ensureContains([0, values.length - 1, 0, 0, 0, 0]);
  voxels.apply(values);
  selectSegment(segmentId);

  return { segmentId, labelMap: voxels.image() };
}

/** Every image's masks. */
export const boundMasks = () => {
  const segments = useSegmentStore().segments;
  return Object.keys(segments.imageSets.value).flatMap((imageId) =>
    segments.imageMasks(imageId)
  );
};

export const bindingOf = (segmentId: string) => store().maskOf(segmentId);

export const extentOf = (segmentId: string) => bindingOf(segmentId)?.extent;

const containsIndex = (extent: Extent3D, [i, j, k]: Index3) =>
  i >= extent[0] &&
  i <= extent[1] &&
  j >= extent[2] &&
  j <= extent[3] &&
  k >= extent[4] &&
  k <= extent[5];

export function offsetOf(segmentId: string, index: Index3) {
  const binding = bindingOf(segmentId);
  if (!binding || !containsIndex(binding.extent, index)) return undefined;
  const dimensions = store().maskVoxels(segmentId).image().getDimensions();
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
export function maskValueAt(segmentId: string, index: Index3) {
  const offset = offsetOf(segmentId, index);
  if (offset === undefined) return undefined;
  return store().maskVoxels(segmentId).scalars()[offset];
}

/** Marks one parent-index voxel for a segment, through the growth path. */
export function seedVoxel(segmentId: string, index: Index3) {
  const voxels = store().maskVoxels(segmentId);
  voxels.materialize();
  voxels.ensureContains([
    index[0],
    index[0],
    index[1],
    index[1],
    index[2],
    index[2],
  ]);
  const offset = offsetOf(segmentId, index)!;
  voxels.scalars()[offset] = SEGMENT_VALUE;
  voxels.image().modified();
}

/**
 * Every marked voxel of a segment as `[i, j, k, value]` in PARENT index space,
 * so two masks with different bounds are still comparable.
 */
export function markedVoxels(segmentId: string) {
  const binding = bindingOf(segmentId);
  if (!binding) return undefined;
  const voxels = store().maskVoxels(segmentId);
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

/**
 * `members` (the image's masks by default) composed as one export part:
 * earlier in the registry wins where two overlap.
 */
export function compositeLabelmap(
  parentImageId: string,
  members?: SegmentMaskEntry[]
) {
  useSegmentationEditsStore().beforeRead();
  const snapshot = captureLabelmapParts(parentImageId, [
    members ?? store().imageMasks(parentImageId),
  ]);
  return composeLabelmapPart(snapshot.parent, snapshot.parts[0]);
}
