import { computed } from 'vue';

import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDatasetStore } from '@/src/store/datasets';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { writeSegmentation } from '@/src/io/readWriteImage';
import { getDataSourceName } from '@/src/io/import/dataSource';
import { stripExtension } from '@/src/utils/path';
import type {
  AnnotationToolKind,
  AnnotationsFile,
  InputValue,
} from '@/backend-contract';
import {
  ANNOTATIONS_FILE_EXTENSION,
  TYPE_TAG_ANNOTATIONS,
  TYPE_TAG_LABELMAP,
} from '@/backend-contract';
import type { AnnotationTool } from '@/src/types/annotation-tool';
import type {
  ProcessingProvider,
  ProcessingValue,
} from '@/src/processing/types';
import {
  mintLabelmapValue,
  mintLabelmapReferenceImage,
  stagedLabelmapFileNames,
  type SegmentGroupView,
} from '@/src/processing/engine/mintLabelmap';
import { mintInputValue } from '@/src/processing/engine/mintInput';
import { mintAnnotationsValue } from '@/src/processing/engine/mintAnnotations';
import {
  annotationToolsViewCount,
  annotationsFileCount,
  encodeAnnotationsFile,
  hasTwoPoints,
  isEncodablePolygon,
  type AnnotationKindView,
  type AnnotationToolsView,
  type PolygonToolView,
  type TwoPointToolView,
} from '@/src/processing/engine/annotationsWire';
import { annotationToolStore } from '@/src/processing/annotationKinds';
import type {
  SourceRefBindingContext,
  SourceRefBindings,
} from '@/src/processing/engine/sourceRefs';
import { usePaintToolStore } from '@/src/store/tools/paint';

// Everything the annotations file is made of, read off the stores in one
// synchronous pass so staging never mixes two images' state.
export type AnnotationsPayload = {
  file: AnnotationsFile;
  name: string;
  referenceImage: InputValue | null;
};

// Reads the active image's inputs off the stores and stages them with a
// provider at Run. Values earn URIs only here: neither the labelmap nor the
// annotations file has server provenance of its own before staging.
export function useInputStaging() {
  const { currentImageID } = useCurrentImage('global');
  const imageCache = useImageCacheStore();
  const datasetStore = useDatasetStore();
  const segmentGroupStore = useSegmentGroupStore();
  const paintStore = usePaintToolStore();

  const activeDataSource = () =>
    datasetStore.getDataSource(currentImageID.value);

  const activeImageName = (): string | undefined => {
    const id = currentImageID.value;
    return (
      imageCache.getImageMetadata(id)?.name ??
      getDataSourceName(activeDataSource()) ??
      undefined
    );
  };

  const segmentGroupView = (): SegmentGroupView => ({
    orderByParent: segmentGroupStore.orderByParent,
    metadataByID: segmentGroupStore.metadataByID,
  });

  const labelmapReferenceImage = (segmentGroupId: string): InputValue | null =>
    mintLabelmapReferenceImage(segmentGroupId, segmentGroupView(), (imageId) =>
      datasetStore.getDataSource(imageId)
    );

  // Tool lists are per image, and so is the staged annotations file: only the
  // active image's finished tools are ever an input.
  const onActiveImage = <T extends { imageID: string }>(
    tools: readonly T[]
  ): T[] => {
    const id = currentImageID.value;
    return id ? tools.filter((tool) => tool.imageID === id) : [];
  };

  // The three stores are independent, so each keeps its own label namespace;
  // the encoder prunes and re-keys them by name.
  const annotationToolsView = computed<AnnotationToolsView>(() => {
    const kindView = <T extends object>(
      kind: AnnotationToolKind,
      hasGeometry: <U extends AnnotationTool>(tool: U) => tool is U & T
    ): AnnotationKindView<AnnotationTool & T> => {
      const store = annotationToolStore(kind);
      return {
        tools: onActiveImage(store.finishedTools).filter(hasGeometry),
        labels: store.labels,
      };
    };
    return {
      rulers: kindView<TwoPointToolView>('rulers', hasTwoPoints),
      rectangles: kindView<TwoPointToolView>('rectangles', hasTwoPoints),
      polygons: kindView<PolygonToolView>('polygons', isEncodablePolygon),
    };
  });

  // Computed, not a function call: placing a tool churns the stores every drag
  // frame, and an unchanged count stops the invalidation there.
  const finishedAnnotationCount = computed(() =>
    annotationToolsViewCount(annotationToolsView.value)
  );

  // The stores this composable already holds are exactly what the binder reads,
  // so the context is assembled here rather than re-wiring them at the caller.
  const sourceRefContext = (): SourceRefBindingContext => ({
    activeDataSource: activeDataSource(),
    backgroundImageId: currentImageID.value ?? undefined,
    activeSegmentGroupId: paintStore.activeSegmentGroupID,
    segmentGroups: segmentGroupView(),
    hasFinishedAnnotations: finishedAnnotationCount.value > 0,
    getDataSource: (imageId) => datasetStore.getDataSource(imageId),
  });

  // The literal 'seg.nrrd' name is required for segment names and colors to be
  // embedded in the serialized output.
  const stageSegmentGroupInput = async (
    p: ProcessingProvider,
    segmentGroupId: string,
    fileName: string
  ): Promise<string[]> => {
    const metadata = segmentGroupStore.metadataByID[segmentGroupId];
    const labelmap = segmentGroupStore.dataIndex[segmentGroupId];
    const referenceImage = labelmapReferenceImage(segmentGroupId);
    if (!referenceImage) {
      throw new Error('Segment group reference image has no server provenance');
    }
    const serialized = await writeSegmentation('seg.nrrd', labelmap, metadata);
    return p.stageInput({
      file: new Blob([serialized]),
      descriptor: {
        type: TYPE_TAG_LABELMAP,
        name: fileName,
        referenceImage: {
          ...referenceImage,
          type: 'image',
        },
      },
    });
  };

  // Returns only the parameters it staged, so the caller owns the merge.
  //
  // Staged one at a time rather than fanned out: serialization deep-copies the
  // whole voxel buffer, so a concurrent map would hold every group's copy at
  // once, and itk-wasm queues the writes on a single shared worker regardless.
  const stageLabelmapInputs = async (
    p: ProcessingProvider,
    bindings: SourceRefBindings
  ): Promise<Record<string, ProcessingValue>> => {
    const staged: Record<string, ProcessingValue> = {};
    for (const [parameterId, segmentGroupIds] of Object.entries(
      bindings.labelmap.groups
    )) {
      const fileNames = stagedLabelmapFileNames(
        segmentGroupIds.map(
          (groupId) => segmentGroupStore.metadataByID[groupId].name
        )
      );
      const uris: string[] = [];
      for (const [index, groupId] of segmentGroupIds.entries()) {
        uris.push(
          ...(await stageSegmentGroupInput(p, groupId, fileNames[index]))
        );
      }
      staged[parameterId] = mintLabelmapValue(uris);
    }
    return staged;
  };

  // The extension is what the CLI spec and the backend both match on, so the
  // base name is the active image's without its own — compound extensions
  // included, so `scan.nii.gz` stages as `scan.annotations.json`.
  const annotationsFileName = (): string => {
    const name = activeImageName() ?? 'image';
    return `${stripExtension(name)}${ANNOTATIONS_FILE_EXTENSION}`;
  };

  const captureAnnotationsPayload = (): AnnotationsPayload => ({
    file: encodeAnnotationsFile(annotationToolsView.value),
    name: annotationsFileName(),
    referenceImage: mintInputValue(activeDataSource()),
  });

  // One file per bound parameter, holding every finished tool the active image
  // had at Run. The image is its own reference image, so a volume without
  // server provenance never gets here — the binder already refused it.
  const stageAnnotationInputs = async (
    p: ProcessingProvider,
    bindings: SourceRefBindings,
    payload: AnnotationsPayload | null
  ): Promise<Record<string, ProcessingValue>> => {
    const [parameterId] = bindings.annotations.parameters;
    if (!parameterId || !payload) return {};
    const { file, name, referenceImage } = payload;

    if (!referenceImage) {
      throw new Error('The active image has no server provenance');
    }
    // The binder validated a live count; this is the encoded file's own count,
    // so a tool deleted between validation and Run cannot stage an empty file.
    if (annotationsFileCount(file) === 0) {
      throw new Error('The active image has no finished annotations');
    }

    const uris = await p.stageInput({
      file: new Blob([JSON.stringify(file)], { type: 'application/json' }),
      descriptor: {
        type: TYPE_TAG_ANNOTATIONS,
        name,
        referenceImage: {
          ...referenceImage,
          type: 'image',
        },
      },
    });
    return {
      [parameterId]: mintAnnotationsValue(uris),
    };
  };

  return {
    activeImageName,
    finishedAnnotationCount,
    sourceRefContext,
    captureAnnotationsPayload,
    stageLabelmapInputs,
    stageAnnotationInputs,
  };
}
