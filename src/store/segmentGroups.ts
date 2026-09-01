import { ref } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import type { TypedArray } from '@kitware/vtk.js/types';
import { defineStore } from 'pinia';
import { normalize } from '@/src/utils/path';
import type { LabelmapSegment } from '@/src/types/segmentation';
import { DEFAULT_SEGMENT_MASKS, CATEGORICAL_COLORS } from '@/src/config';
import { readImage, writeSegmentation } from '@/src/io/readWriteImage';
import {
  parseSegNrrdMetadata,
  overlaySegmentMetadata,
} from '@/src/io/segNrrdMetadata';
import type { ArtifactRestoreSource } from '@/src/io/import/processors/restoreStateFile';
import {
  type DataSelection,
  getImage,
  isRegularImage,
} from '@/src/utils/dataSelection';
import vtkImageExtractComponents from '@/src/utils/imageExtractComponentsFilter';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  useSegmentationStore,
  type ArtifactMetadata,
} from '@/src/store/segmentations';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import vtkLabelMap from '../vtk/LabelMap';
import { StateFile, Manifest, SegmentGroup } from '../io/state-file/schema';
import { makeSegmentGroupArchivePath } from '../io/state-file/segmentGroupArchivePath';
import { FileEntry } from '../io/types';
import { ensureSameSpace } from '../io/resample/resample';
import { untilLoaded } from '../composables/untilLoaded';
import { useDatasetStore } from './datasets';

const LabelmapArrayType = Uint8Array;
export type LabelmapArrayType = Uint8Array;

export const LABELMAP_BACKGROUND_VALUE = 0;
export const makeDefaultSegmentName = (value: number) => `Segment ${value}`;
export const makeDefaultSegmentGroupName = (baseName: string, index: number) =>
  `Segment Group ${index} for ${baseName}`;
const numberer = (index: number) => (index <= 1 ? '' : `${index}`); // start numbering at 2

export function createLabelmapFromImage(imageData: vtkImageData) {
  const points = new LabelmapArrayType(imageData.getNumberOfPoints());
  const labelmap = vtkLabelMap.newInstance(
    imageData.get('spacing', 'origin', 'direction')
  );
  labelmap.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: points,
    })
  );
  labelmap.setDimensions(imageData.getDimensions());
  labelmap.computeTransforms();

  return labelmap;
}

function convertToUint8(array: number[] | TypedArray): Uint8Array {
  const uint8Array = new Uint8Array(array.length);
  for (let i = 0; i < array.length; i++) {
    const value = array[i];
    uint8Array[i] = value < 0 || value > 255 ? 0 : value;
  }
  return uint8Array;
}

function getLabelMapScalars(imageData: vtkImageData) {
  const scalars = imageData.getPointData().getScalars();
  let values = scalars.getData();

  if (!(values instanceof LabelmapArrayType)) {
    values = convertToUint8(values);
  }

  return vtkDataArray.newInstance({
    numberOfComponents: scalars.getNumberOfComponents(),
    values,
  });
}

export function toLabelMap(imageData: vtkImageData) {
  const labelmap = vtkLabelMap.newInstance(
    imageData.get('spacing', 'origin', 'direction', 'extent', 'dataDescription')
  );

  labelmap.setDimensions(imageData.getDimensions());
  labelmap.computeTransforms();

  // outline rendering only supports UInt8Array image types
  const scalars = getLabelMapScalars(imageData);
  labelmap.getPointData().setScalars(scalars);

  return labelmap;
}

export function extractEachComponent(input: vtkImageData) {
  const numComponents = input
    .getPointData()
    .getScalars()
    .getNumberOfComponents();
  const extractComponentsFilter = vtkImageExtractComponents.newInstance();
  extractComponentsFilter.setInputData(input);
  return Array.from({ length: numComponents }, (_, i) => {
    extractComponentsFilter.setComponents([i]);
    extractComponentsFilter.update();
    return extractComponentsFilter.getOutputData() as vtkImageData;
  });
}

/** The artifact layer: labelmap bytes, decode, and the legacy wire format. */
export const useSegmentGroupStore = defineStore('segmentGroup', () => {
  type _This = ReturnType<typeof useSegmentGroupStore>;
  const imageCacheStore = useImageCacheStore();
  const segmentationStore = useSegmentationStore();

  // One artifact index for the app, owned by the segmentation store; exposed
  // here for the edit paths still keyed on segment-group ids until C6.
  const { artifactIndex: dataIndex, artifactOrderByParent: orderByParent } =
    segmentationStore;

  /**
   * Adds a given image + metadata as a labelmap.
   */
  function addLabelmap(
    labelmap: vtkLabelMap,
    metadata: ArtifactMetadata,
    segments: LabelmapSegment[] = []
  ) {
    const id = segmentationStore.registerArtifact(labelmap, metadata);
    segmentationStore.setArtifactSegments(id, segments);
    return id;
  }

  /**
   * Creates a new labelmap entry from a parent/source image.
   */
  function newLabelmapFromImage(parentID: string) {
    const imageData = imageCacheStore.getVtkImageData(parentID);
    if (!imageData) {
      return null;
    }

    const id = segmentationStore.createArtifactForImage(parentID);
    segmentationStore.setArtifactSegments(
      id,
      structuredClone(DEFAULT_SEGMENT_MASKS)
    );
    return id;
  }

  /**
   * Deletes a labelmap.
   */
  function removeGroup(id: string) {
    segmentationStore.removeArtifact(id);
  }

  let nextColorIndex = 0;
  function getNextColor() {
    const color = CATEGORICAL_COLORS[nextColorIndex];
    nextColorIndex = (nextColorIndex + 1) % CATEGORICAL_COLORS.length;
    return [...color, 255] as const;
  }

  // `imageId` may be undefined when the labelmap's bytes did not arrive
  // through a loaded image dataset (a zip-restored group). DICOM-SEG decoding
  // still requires a source image, while file-header metadata can be supplied
  // directly for archive-backed images.
  async function decodeSegments(
    imageId: DataSelection | undefined,
    image: vtkLabelMap,
    component = 0,
    headerMetadata?: Map<string, string>
  ) {
    const dicomStore = useDICOMStore();
    if (
      imageId !== undefined &&
      !isRegularImage(imageId) &&
      dicomStore.volumeInfo[imageId]?.kind !== 'cine'
    ) {
      await untilLoaded(imageId);

      const chunkImage = imageCacheStore.imageById[imageId] as DicomChunkImage;
      if (chunkImage.getModality() === 'SEG' && chunkImage.segBuildInfo) {
        const segments = chunkImage.segBuildInfo.segmentAttributes[component];
        return segments.map((segment) => ({
          value: segment.labelID,
          name: segment.SegmentLabel,
          color: [...segment.recommendedDisplayRGBValue, 255],
          visible: true,
        }));
      }
    }

    // Slicer-convention `.seg.nrrd` embedded metadata: a labelmap
    // produced by a backend CLI carries its real segment names/colors in the
    // NRRD header, captured onto the loaded image at import.
    //
    // MERGE, not replace: the distinct nonzero voxel values are the spine, so
    // a labelled voxel with NO `Segment{N}_*` block still gets a default,
    // visible, manageable segment instead of being dropped. Embedded
    // name/color/visibility are overlaid onto the matching `LabelValue == voxel
    // value`; undescribed values keep their default.
    const embedded =
      headerMetadata ??
      (imageId !== undefined
        ? imageCacheStore.imageById[imageId]?.headerMetadata
        : undefined);
    const described = embedded ? parseSegNrrdMetadata(embedded) : undefined;

    // Distinct nonzero voxel values, ascending — the segment spine.
    // Labelmap scalars are Uint8Array by construction (both callers pass a
    // `toLabelMap` result, which forces UInt8), so a fixed 256-slot presence map
    // gives one branch-free typed-array write per voxel on the hot path, and the
    // 0..255 sweep is already ascending (no Set, no per-voxel Number(), no sort).
    const voxelValues = image.getPointData().getScalars().getData();
    const present = new Uint8Array(256);
    for (let index = 0; index < voxelValues.length; index += 1) {
      present[voxelValues[index]] = 1;
    }
    const values: number[] = [];
    for (let value = 0; value < present.length; value += 1) {
      if (present[value] && value !== LABELMAP_BACKGROUND_VALUE)
        values.push(value);
    }

    return overlaySegmentMetadata(values, described, (value) => ({
      value,
      name: makeDefaultSegmentName(value),
      color: [...getNextColor()],
      visible: true,
    }));
  }

  /**
   * Converts an image to a labelmap.
   *
   * Returns the created artifact id(s) — one per component of the source
   * image (one for the common single-component case). Awaits the per-component
   * adds so the caller can act on the created artifacts synchronously afterwards
   * (corroboration/present + descriptor application key off the
   * returned ids rather than racing the artifact order).
   */
  async function convertImageToLabelmap(
    imageID: DataSelection,
    parentID: DataSelection,
    source?: ArtifactMetadata['source']
  ): Promise<string[]> {
    if (imageID === parentID)
      throw new Error('Cannot convert an image to be a labelmap of itself');

    await untilLoaded(imageID);

    const [childImage, parentImage] = await Promise.all(
      [imageID, parentID].map(getImage)
    );

    if (!childImage || !parentImage)
      throw new Error('Image and/or parent datasets do not exist');

    const intersects = vtkBoundingBox.intersects(
      parentImage.getBounds(),
      childImage.getBounds()
    );
    if (!intersects) {
      throw new Error(
        'Segment group and parent image bounds do not intersect. So there is no overlap in physical space.'
      );
    }

    const baseName =
      imageCacheStore.getImageMetadata(imageID)?.name ?? '(no name)';

    const componentCount = childImage
      .getPointData()
      .getScalars()
      .getNumberOfComponents();
    // for each component, create create new vtkImageData with just one component, pulled from each component of childImage
    const images =
      componentCount === 1 ? [childImage] : extractEachComponent(childImage);

    return Promise.all(
      images.map(async (image, component) => {
        const matchingParentSpace = await ensureSameSpace(
          parentImage,
          image,
          true
        );
        const labelmapImage = toLabelMap(matchingParentSpace);

        const segments = await decodeSegments(
          imageID,
          labelmapImage,
          component
        );

        const name = segmentationStore.pickUniqueArtifactName(
          (index: number) => `${baseName} ${numberer(index)}`,
          parentID
        );
        return addLabelmap(
          labelmapImage,
          {
            name,
            parentImage: parentID,
            ...(source ? { source } : {}),
          },
          segments as LabelmapSegment[]
        );
      })
    );
  }

  /**
   * Updates an artifact's metadata
   */
  function updateMetadata(
    artifactId: string,
    metadata: Partial<ArtifactMetadata>
  ) {
    segmentationStore.updateArtifactMeta(artifactId, metadata);
  }

  const saveFormat = ref('vti');

  // wire-format shim, replaced in C7
  const legacySegmentDescriptors = (artifactId: string) =>
    segmentationStore.labelmapSegmentsByArtifact[artifactId] ?? [];

  /**
   * Serializes the store's state.
   */
  async function serialize(state: StateFile) {
    const { zip } = state;
    const usedArchivePaths = new Set<string>();

    // Artifact order per parent image is implicitly preserved based on
    // the order of serialized entries.

    const parents = Object.keys(orderByParent);
    const serialized = parents.flatMap((parentID) =>
      orderByParent[parentID].map((id) => {
        const metadata = segmentationStore.artifactMeta[id];
        const segments = legacySegmentDescriptors(id);
        return {
          id,
          path: makeSegmentGroupArchivePath(
            metadata.name,
            saveFormat.value,
            usedArchivePaths
          ),
          segments,
          // wire-format shim, replaced in C7
          metadata: {
            name: metadata.name,
            parentImage: metadata.parentImage,
            segments: {
              order: segments.map((segment) => segment.value),
              byValue: Object.fromEntries(
                segments.map((segment) => [segment.value, segment])
              ),
            },
            ...(metadata.source ? { source: metadata.source } : {}),
          },
        };
      })
    );

    state.manifest.segmentGroups = serialized.map(({ id, path, metadata }) => ({
      id,
      path,
      metadata,
    }));

    // save labelmap images
    await Promise.all(
      serialized.map(async ({ id, path, segments }) => {
        const serializedImage = await writeSegmentation(
          saveFormat.value,
          dataIndex[id],
          segments
        );
        zip.file(path, serializedImage);
      })
    );
  }

  /**
   * Rehydrates the store's state.
   */
  async function deserialize(
    this: _This,
    manifest: Manifest,
    stateFiles: FileEntry[],
    dataIDMap: Record<string, string>,
    // Per-group artifact source, resolved by the restore setup (see
    // resolveArtifactRestoreSources in restoreStateFile.ts, the single owner
    // of the synthesized-leaf and ownership policy). Mapped through dataIDMap
    // here.
    artifactSources: Record<string, ArtifactRestoreSource> = {}
  ) {
    const { segmentGroups } = manifest;
    const datasetStore = useDatasetStore();

    const segmentGroupIDMap: Record<string, string> = {};
    // Non-silent drops: every group left out of the restore is recorded here
    // with a concrete reason so the caller can surface it.
    const skipped: Array<{ name: string; reason: string }> = [];

    if (!segmentGroups || segmentGroups.length === 0) {
      return { segmentGroupIDMap, skipped };
    }

    // First restore the data, then restore the store.
    // This preserves the per-parent artifact ordering.

    // `path` is authoritative for bytes when present: a re-saved
    // zip carries the archive bytes AND the provenance `dataSourceId`, but
    // `dataIDMap` is keyed by save-time DATASET ids. Consulting it for a
    // path-carrying group could hang restore on a missing key, or worse,
    // build the group from an unrelated dataset's voxels and then delete that
    // dataset. The `dataSourceId` branch remains for composed manifests,
    // whose groups carry no archive bytes — see `artifactStoreId` for how the
    // artifact's store id is resolved.
    // The temporary artifact dataset id (if any) is resolved by the CALLER
    // before the restore `try`, so its cleanup can run unconditionally in a
    // `finally` even when this load throws. This function yields the image and
    // any file-header metadata needed to reconstruct segment descriptors.
    async function loadSegmentGroupImage(
      segmentGroup: SegmentGroup,
      storeId: string | undefined
    ) {
      if (segmentGroup.path !== undefined) {
        const file = stateFiles.find(
          (entry) => entry.archivePath === normalize(segmentGroup.path!)
        )?.file;
        return readImage(file!);
      }

      await untilLoaded(storeId!);
      const image = imageCacheStore.getVtkImageData(storeId!);
      if (!image) {
        throw new Error(
          `Could not get image data for dataSourceId ${segmentGroup.dataSourceId}`
        );
      }
      return {
        image,
        headerMetadata: imageCacheStore.imageById[storeId!]?.headerMetadata,
      };
    }

    // A path-less group's artifact store id: the restore setup already
    // resolved which STATE id carries each group's artifact (synthesized leaf
    // or covering dataset — a policy owned entirely by restoreStateFile.ts);
    // this only maps that id through dataIDMap.
    const artifactStoreId = (segmentGroup: SegmentGroup) => {
      if (segmentGroup.path !== undefined) return undefined;
      const source = artifactSources[segmentGroup.id];
      return source !== undefined ? dataIDMap[source.stateId] : undefined;
    };

    // Resilient restore. Skip BEFORE awaiting anything a
    // group whose base image is unresolved, or a path-less group whose artifact
    // datasource never materialized — `untilLoaded(undefined)` never times out
    // and would hang restore forever. A missing key is knowable up front, so
    // the pre-await guard catches it; the per-group settle below is the safety
    // net for a fetch/parse failure. Skipped groups drop out of the id map so
    // they are left out of the restore.
    const attachable = segmentGroups.filter((segmentGroup) => {
      if (dataIDMap[segmentGroup.metadata.parentImage] === undefined) {
        skipped.push({
          name: segmentGroup.metadata.name,
          reason: 'parent image did not load',
        });
        return false;
      }
      if (segmentGroup.path !== undefined) return true;
      const hasArtifact = artifactStoreId(segmentGroup) !== undefined;
      if (!hasArtifact) {
        skipped.push({
          name: segmentGroup.metadata.name,
          reason: 'artifact source unavailable',
        });
      }
      return hasArtifact;
    });

    // Every path-less group's temporary imported artifact must be removed
    // exactly ONCE, and only AFTER every group that reads it has settled.
    // prepareLeafDataSources dedupes leaves by dataSourceId, so two path-less
    // groups referencing the same artifact share ONE temp dataset id; removing
    // it inside each group's `finally` let the first group's cleanup starve the
    // second group's `getVtkImageData`, dropping it as unreadable. Collect the
    // unique ids here and remove them after the `Promise.all` — in a `finally`
    // so the cleanup runs even if a group throws unexpectedly. Archive-backed
    // groups (path !== undefined) own no temp dataset.
    // Collected from EVERY group, not just the attachable ones: a group
    // skipped at the parent-image check may still have imported its artifact
    // leaf, and that orphan would otherwise sit in the dataset store and
    // re-serialize into every future save.
    const tempStoreIdsToRemove = new Set(
      segmentGroups
        .filter(
          (segmentGroup) => artifactSources[segmentGroup.id]?.temporary === true
        )
        .map(artifactStoreId)
        .filter((storeId): storeId is string => storeId !== undefined)
    );

    let labelmapResults;
    try {
      labelmapResults = await Promise.all(
        attachable.map(async (segmentGroup) => {
          const storeId = artifactStoreId(segmentGroup);
          try {
            const { image, headerMetadata } = await loadSegmentGroupImage(
              segmentGroup,
              storeId
            );
            const labelmapImage = toLabelMap(image);

            // Descriptor-less group: `segments` is optional on the wire. When absent,
            // build the catalog through the SAME decode/enumerate/default path
            // live convertImageToLabelmap uses (voxel enumeration + embedded
            // .seg.nrrd metadata overlay + default names/colors) — parity is
            // pinned by segmentGroupDescriptorlessParity.spec.ts.
            const wireSegments = segmentGroup.metadata.segments;
            const segments = wireSegments
              ? wireSegments.order
                  .map((value) => wireSegments.byValue[String(value)])
                  .filter((segment) => !!segment)
              : await decodeSegments(storeId, labelmapImage, 0, headerMetadata);

            return {
              segmentGroup,
              labelmapImage,
              segments: segments as LabelmapSegment[],
            };
          } catch {
            // A parse/read failure skips just this group — never rejects the
            // whole restore; the survivors still attach. Recorded (not silent) so
            // the caller can report it.
            skipped.push({
              name: segmentGroup.metadata.name,
              reason: 'could not read/parse labelmap',
            });
            return undefined;
          }
        })
      );
    } finally {
      tempStoreIdsToRemove.forEach((storeId) => datasetStore.remove(storeId));
    }

    labelmapResults.forEach((result) => {
      if (!result) return;
      const { segmentGroup, labelmapImage, segments } = result;
      const { name, source } = segmentGroup.metadata;
      const parentImage = dataIDMap[segmentGroup.metadata.parentImage];

      segmentGroupIDMap[segmentGroup.id] = addLabelmap(
        labelmapImage,
        { name, parentImage, ...(source ? { source } : {}) },
        segments
      );
    });

    return { segmentGroupIDMap, skipped };
  }

  // --- api --- //

  return {
    dataIndex,
    orderByParent,
    saveFormat,
    addLabelmap,
    newLabelmapFromImage,
    removeGroup,
    convertImageToLabelmap,
    updateMetadata,
    serialize,
    deserialize,
  };
});
