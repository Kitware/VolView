import { computed, reactive, ref, toRaw, watch } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import type { TypedArray } from '@kitware/vtk.js/types';
import { defineStore } from 'pinia';
import { normalize } from '@/src/utils/path';
import { useIdStore } from '@/src/store/id';
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { normalizeForStore, removeFromArray } from '@/src/utils';
import { SegmentMask } from '@/src/types/segment';
import { DEFAULT_SEGMENT_MASKS, CATEGORICAL_COLORS } from '@/src/config';
import { readImage, writeSegmentation } from '@/src/io/readWriteImage';
import {
  parseSegNrrdMetadata,
  overlaySegmentMetadata,
} from '@/src/io/segNrrdMetadata';
import {
  type DataSelection,
  getImage,
  isRegularImage,
} from '@/src/utils/dataSelection';
import vtkImageExtractComponents from '@/src/utils/imageExtractComponentsFilter';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import vtkLabelMap from '../vtk/LabelMap';
import {
  StateFile,
  Manifest,
  SegmentGroupMetadata,
  SegmentGroup,
  manifestDatasets,
} from '../io/state-file/schema';
import { leafStateId } from '@/src/io/import/dataSource';
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

export type SegmentGroupMetadata = {
  name: string;
  parentImage: string;
  segments: {
    order: number[];
    byValue: Record<number, SegmentMask>;
  };
  // Provenance of a job-produced segment group — display provenance only:
  // nothing keys dedup or attach semantics off it. Optional +
  // additive — hand-painted groups have none. Flows through addLabelmap and
  // round-trips the `.volview.zip` (see the matching `SegmentGroupSource` in
  // io/state-file/schema.ts).
  source?: {
    jobId: string;
    outputId: string;
  };
};

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

export const useSegmentGroupStore = defineStore('segmentGroup', () => {
  type _This = ReturnType<typeof useSegmentGroupStore>;
  const imageCacheStore = useImageCacheStore();

  const dataIndex = reactive<Record<string, vtkLabelMap>>(Object.create(null));
  const metadataByID = reactive<Record<string, SegmentGroupMetadata>>(
    Object.create(null)
  );
  const orderByParent = ref<Record<string, string[]>>(Object.create(null));

  /**
   * Gets the metadata for a labelmap.
   * @param segmentGroupID
   * @param segmentValue
   */
  function getMetadata(segmentGroupID: string) {
    if (!(segmentGroupID in metadataByID))
      throw new Error('No such labelmap ID');
    return metadataByID[segmentGroupID];
  }

  /**
   * Gets a segment.
   * @param segmentGroupID
   * @param segmentValue
   * @returns
   */
  function getSegment(segmentGroupID: string, segmentValue: number) {
    const metadata = getMetadata(segmentGroupID);
    if (!(segmentValue in metadata.segments.byValue))
      throw new Error('No such segment');
    return metadata.segments.byValue[segmentValue];
  }

  /**
   * Validates that a segment does not violate constraints.
   *
   * Assumes that the given segment is not yet part of the labelmap segments.
   * @param segmentGroupID
   * @param segment
   */
  function validateSegment(segmentGroupID: string, segment: SegmentMask) {
    return (
      // cannot be zero (background)
      segment.value !== 0 &&
      // cannot already exist
      !(segment.value in getMetadata(segmentGroupID).segments.byValue)
    );
  }

  /**
   * Adds a given image + metadata as a labelmap.
   */
  function addLabelmap(
    this: _This,
    labelmap: vtkLabelMap,
    metadata: SegmentGroupMetadata
  ) {
    const id = useIdStore().nextId();

    dataIndex[id] = labelmap;
    metadataByID[id] = metadata;
    orderByParent.value[metadata.parentImage] ??= [];
    orderByParent.value[metadata.parentImage].push(id);

    return id;
  }

  // Used for constructing labelmap names in newLabelmapFromImage.
  // Cleared by the onImageDeleted cascade below.
  const nextDefaultIndex: Record<string, number> = Object.create(null);

  function pickUniqueName(
    formatName: (index: number) => string,
    parentID: string
  ) {
    const existingNames = new Set(
      Object.values(metadataByID).map((meta) => meta.name)
    );
    let name = '';
    do {
      const nameIndex = nextDefaultIndex[parentID] ?? 1;
      nextDefaultIndex[parentID] = nameIndex + 1;
      name = formatName(nameIndex);
    } while (existingNames.has(name));
    return name;
  }

  /**
   * Creates a new labelmap entry from a parent/source image.
   */
  function newLabelmapFromImage(this: _This, parentID: string) {
    const imageData = imageCacheStore.getVtkImageData(parentID);
    if (!imageData) {
      return null;
    }
    const baseName =
      imageCacheStore.getImageMetadata(parentID)?.name ?? '(no name)';

    const labelmap = createLabelmapFromImage(imageData);

    const { order, byKey } = normalizeForStore(
      structuredClone(DEFAULT_SEGMENT_MASKS),
      'value'
    );

    const name = pickUniqueName(
      (index: number) => makeDefaultSegmentGroupName(baseName, index),
      parentID
    );

    return addLabelmap.call(this, labelmap, {
      name,
      parentImage: parentID,
      segments: { order, byValue: byKey },
    });
  }

  /**
   * Deletes a labelmap.
   */
  function removeGroup(id: string) {
    if (!(id in dataIndex)) return;
    const { parentImage } = metadataByID[id];
    removeFromArray(orderByParent.value[parentImage], id);
    delete dataIndex[id];
    delete metadataByID[id];
  }

  let nextColorIndex = 0;
  function getNextColor() {
    const color = CATEGORICAL_COLORS[nextColorIndex];
    nextColorIndex = (nextColorIndex + 1) % CATEGORICAL_COLORS.length;
    return [...color, 255] as const;
  }

  // `imageId` may be undefined when the labelmap's bytes did not arrive
  // through a loaded image dataset (a zip-restored group): the DICOM-SEG and
  // embedded-metadata lookups have no source then, and the enumeration/default
  // path below is the whole decode.
  async function decodeSegments(
    imageId: DataSelection | undefined,
    image: vtkLabelMap,
    component = 0
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
    // MERGE, not replace (issue #6): the distinct nonzero voxel values are the
    // spine, so a labelled voxel with NO `Segment{N}_*` block still gets a
    // default, visible, manageable segment instead of being dropped. Embedded
    // name/color/visibility are overlaid onto the matching `LabelValue == voxel
    // value`; undescribed values keep their default.
    const embedded =
      imageId !== undefined
        ? imageCacheStore.imageById[imageId]?.segmentMetadata
        : undefined;
    const described = embedded ? parseSegNrrdMetadata(embedded) : undefined;

    // Distinct nonzero voxel values, ascending — the segment spine (issue #6).
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
   * Returns the created segment-group id(s) — one per component of the source
   * image (one for the common single-component case). Awaits the per-component
   * adds so the caller can act on the created groups synchronously afterwards
   * (corroboration/present + descriptor application key off the
   * returned ids rather than racing `orderByParent`).
   */
  async function convertImageToLabelmap(
    imageID: DataSelection,
    parentID: DataSelection,
    source?: SegmentGroupMetadata['source']
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

    // Loaded-artifact provenance: a URI-loaded child (a job result
    // opened via loadAsImport, an external URL load) hands its single verbatim
    // URI to the created group(s) so a later save can point back at it.
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
        const { order, byKey } = normalizeForStore(segments, 'value');
        const segmentGroupStore = useSegmentGroupStore();

        const name = pickUniqueName(
          (index: number) => `${baseName} ${numberer(index)}`,
          parentID
        );
        const id = segmentGroupStore.addLabelmap(labelmapImage, {
          name,
          parentImage: parentID,
          segments: { order, byValue: byKey },
          // Job-produced groups carry a `source: {jobId, outputId}` provenance
          // tag so they round-trip the
          // .volview.zip; hand-painted / session-restore conversions pass none.
          ...(source ? { source } : {}),
        });
        return id;
      })
    );
  }

  /**
   * Updates a labelmap's metadata
   * @param segmentGroupID
   * @param metadata
   */
  function updateMetadata(
    segmentGroupID: string,
    metadata: Partial<SegmentGroupMetadata>
  ) {
    metadataByID[segmentGroupID] = {
      ...getMetadata(segmentGroupID),
      ...metadata,
    };
  }

  /**
   * Creates a new default segment with an unallocated value.
   *
   * The value picked is the smallest unused value greater than 0.
   * @param segmentGroupID
   */
  function createNewSegment(segmentGroupID: string): SegmentMask {
    const { segments } = getMetadata(segmentGroupID);

    let value = 1;
    for (; value <= segments.order.length; value++) {
      if (!(value in segments.byValue)) break;
    }

    return {
      name: makeDefaultSegmentName(value),
      value,
      color: [...getNextColor()],
      visible: true,
      locked: false, // default to unlocked
    };
  }

  /**
   * Adds a segment to a labelmap.
   *
   * If no segment is provided, a default one is provided.
   * Duplicate segment values throw an error.
   * @param segmentGroupID
   * @param segment
   */
  function addSegment(segmentGroupID: string, segment?: SegmentMask) {
    const metadata = getMetadata(segmentGroupID);
    const seg = segment ?? createNewSegment(segmentGroupID);
    if (!validateSegment(segmentGroupID, seg))
      throw new Error('Invalid segment');
    metadata.segments.byValue[seg.value] = seg;
    metadata.segments.order.push(seg.value);
    return seg;
  }

  /**
   * Updates a segment's properties.
   *
   * Does not allow updating the segment value.
   * @param segmentGroupID
   * @param segmentValue
   * @param segmentUpdate
   */
  function updateSegment(
    segmentGroupID: string,
    segmentValue: number,
    segmentUpdate: Partial<Omit<SegmentMask, 'value'>>
  ) {
    const metadata = getMetadata(segmentGroupID);
    const segment = getSegment(segmentGroupID, segmentValue);
    metadata.segments.byValue[segmentValue] = {
      ...toRaw(segment),
      ...segmentUpdate,
    };
  }

  /**
   * Deletes a segment from a labelmap.
   * @param segmentGroupID
   * @param segmentValue
   */
  function deleteSegment(segmentGroupID: string, segmentValue: number) {
    const { segments } = getMetadata(segmentGroupID);
    removeFromArray(segments.order, segmentValue);
    delete segments.byValue[segmentValue];

    dataIndex[segmentGroupID].replaceLabelValue(
      segmentValue,
      LABELMAP_BACKGROUND_VALUE
    );
  }

  const saveFormat = ref('vti');

  /**
   * Serializes the store's state.
   */
  async function serialize(state: StateFile) {
    const { zip } = state;
    const usedArchivePaths = new Set<string>();

    // orderByParent is implicitly preserved based on
    // the order of serialized entries.

    const parents = Object.keys(orderByParent.value);
    const serialized = parents.flatMap((parentID) => {
      const segmentGroupIDs = orderByParent.value[parentID];
      return segmentGroupIDs.map((id) => {
        const metadata = metadataByID[id];
        return {
          id,
          path: makeSegmentGroupArchivePath(
            metadata.name,
            saveFormat.value,
            usedArchivePaths
          ),
          metadata: {
            ...metadata,
            parentImage: metadata.parentImage,
          },
        };
      });
    });

    state.manifest.segmentGroups = serialized;

    // save labelmap images
    await Promise.all(
      serialized.map(async ({ id, path }) => {
        const serializedImage = await writeSegmentation(
          saveFormat.value,
          dataIndex[id],
          metadataByID[id]
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
    dataIDMap: Record<string, string>
  ) {
    const { segmentGroups } = manifest;
    const datasetStore = useDatasetStore();

    const segmentGroupIDMap: Record<string, string> = {};
    // Non-silent drops: every group left out of the restore is recorded here
    // with a concrete reason so the caller can surface it (the drop LOGIC is
    // unchanged — this only makes the omission visible).
    const skipped: Array<{ name: string; reason: string }> = [];

    if (!segmentGroups || segmentGroups.length === 0) {
      return { segmentGroupIDMap, skipped };
    }

    // First restore the data, then restore the store.
    // This preserves ordering from orderByParent.

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
    // `finally` even when this load throws. This function just yields the image.
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
      return image;
    }

    // A path-less group's artifact resolves through the synthesized-leaf
    // namespace when leaf preparation minted one, or through the DATASET that
    // covers its source id when it did not (a covered artifact synthesizes no
    // leaf) — the latter is how legacy manifests without `datasets` restore,
    // where every uri source stands in for a dataset keyed by its stringified
    // source id. Both lookups are deterministic; the bare `String(dataSourceId)`
    // key of old shared the dataset-id string space and made the winner
    // leaf-completion-order luck.
    const datasetIdBySourceId = new Map(
      manifestDatasets(manifest).map((ds) => [ds.dataSourceId, ds.id])
    );
    const artifactStoreId = (segmentGroup: SegmentGroup) => {
      if (
        segmentGroup.path !== undefined ||
        segmentGroup.dataSourceId === undefined
      ) {
        return undefined;
      }
      const minted = dataIDMap[leafStateId(segmentGroup.dataSourceId)];
      if (minted !== undefined) return minted;
      const coveringDatasetId = datasetIdBySourceId.get(
        segmentGroup.dataSourceId
      );
      return coveringDatasetId !== undefined
        ? dataIDMap[coveringDatasetId]
        : undefined;
    };

    // Resilient restore. Skip BEFORE awaiting anything a
    // group whose base image is unresolved, or a path-less group whose artifact
    // datasource never materialized — `untilLoaded(undefined)` never times out
    // and would hang restore forever. A missing key is knowable up front, so
    // this pre-await guard is the deterministic fix; the per-group settle below
    // is the safety net for a fetch/parse failure. Skipped groups drop out of
    // the id map so they are left out of the restore.
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
        .map(artifactStoreId)
        .filter((storeId): storeId is string => storeId !== undefined)
    );

    let labelmapResults;
    try {
      labelmapResults = await Promise.all(
        attachable.map(async (segmentGroup) => {
          const storeId = artifactStoreId(segmentGroup);
          try {
            const image = await loadSegmentGroupImage(segmentGroup, storeId);
            const labelmapImage = toLabelMap(image);

            // Descriptor-less group: `segments` is optional on the wire. When absent,
            // build the catalog through the SAME decode/enumerate/default path
            // live convertImageToLabelmap uses (voxel enumeration + embedded
            // .seg.nrrd metadata overlay + default names/colors) — parity is
            // pinned by segmentGroupDescriptorlessParity.spec.ts.
            const segments =
              segmentGroup.metadata.segments ??
              (await (async () => {
                const decoded = await decodeSegments(storeId, labelmapImage);
                const { order, byKey } = normalizeForStore(decoded, 'value');
                return { order, byValue: byKey };
              })());

            const id = useIdStore().nextId();
            dataIndex[id] = labelmapImage;
            return { segmentGroup, id, segments };
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
      const { segmentGroup, id: newID, segments } = result;
      segmentGroupIDMap[segmentGroup.id] = newID;

      const parentImage = dataIDMap[segmentGroup.metadata.parentImage];
      metadataByID[newID] = { ...segmentGroup.metadata, parentImage, segments };

      orderByParent.value[parentImage] ??= [];
      orderByParent.value[parentImage].push(newID);
    });

    return { segmentGroupIDMap, skipped };
  }

  // --- sync segments --- //

  const segmentByGroupID = computed(() => {
    return Object.entries(metadataByID).reduce<Record<string, SegmentMask[]>>(
      (acc, [id, metadata]) => {
        const {
          segments: { order, byValue },
        } = metadata;
        const segments = order.map((value) => byValue[value]);
        return { ...acc, [id]: segments };
      },
      {}
    );
  });

  watch(
    segmentByGroupID,
    (segsByID) => {
      Object.entries(segsByID).forEach(([id, segments]) => {
        // ensure segments are not proxies
        dataIndex[id].setSegments(toRaw(segments).map((seg) => toRaw(seg)));
      });
    },
    { immediate: true }
  );

  // --- handle deletions --- //

  onImageDeleted((deleted) => {
    deleted.forEach((parentID) => {
      delete nextDefaultIndex[parentID];
      // Iterate a COPY: removeGroup splices the same orderByParent array via
      // removeFromArray, so forEaching the live array skips every other group
      // when an image has 2+ groups (the normal case once job labelmaps and
      // multi-component conversions land).
      [...(orderByParent.value[parentID] ?? [])].forEach(removeGroup);
    });
  });

  // --- api --- //

  return {
    dataIndex,
    metadataByID,
    orderByParent,
    segmentByGroupID,
    saveFormat,
    addLabelmap,
    newLabelmapFromImage,
    removeGroup,
    convertImageToLabelmap,
    updateMetadata,
    addSegment,
    getSegment,
    updateSegment,
    deleteSegment,
    serialize,
    deserialize,
  };
});
