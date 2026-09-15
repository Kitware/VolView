import {
  captureLabelmapParts,
  composeLabelmapPart,
} from '@/src/segmentation/io/composition';
import { layerFileName } from '@/src/segmentation/io/export';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import {
  acceptsMultipleLabelmaps,
  planSegmentationInput,
} from './segmentationInput';
import type { TaskFormModel } from '@/src/processing/engine/formModel';
import { computed } from 'vue';

import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDatasetStore } from '@/src/store/datasets';
import { useSegmentationStore } from '@/src/segmentation/store';
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
import { mintLabelmapValue } from '@/src/processing/engine/mintLabelmap';
import { mintInputValue } from '@/src/processing/engine/mintInput';
import { mintAnnotationsValue } from '@/src/processing/engine/mintAnnotations';
import {
  annotationToolsViewCount,
  annotationsFileCount,
  encodeAnnotationsFile,
  hasTwoPoints,
  isEncodablePolygon,
  type AnnotationKindView,
  type PolygonToolView,
  type TwoPointToolView,
} from '@/src/processing/engine/annotationsWire';
import { annotationToolStore } from '@/src/processing/annotationKinds';
import type {
  SourceRefBindingContext,
  SourceRefBindings,
} from '@/src/processing/engine/sourceRefs';

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
  const segmentationStore = useSegmentationStore();

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

  // Tool lists are per image, and so is the staged annotations file: only the
  // active image's finished tools are ever an input.
  const onActiveImage = <T extends { imageID: string }>(
    tools: readonly T[]
  ): T[] => {
    const id = currentImageID.value;
    return id ? tools.filter((tool) => tool.imageID === id) : [];
  };

  // Each geometry kind carries the shared segments; the encoder prunes and
  // re-keys them by name within that kind's wire namespace.
  const annotationToolsView = computed(() => {
    const kindView = <T extends object>(
      kind: AnnotationToolKind,
      hasGeometry: <U extends AnnotationTool>(tool: U) => tool is U & T
    ): AnnotationKindView<AnnotationTool & T> => {
      const store = annotationToolStore(kind);
      const { segments } = store;
      return {
        // The segment's name travels with the tool: identity on the wire is
        // the name, inside this kind's own namespace.
        tools: onActiveImage(store.finishedTools)
          .filter(hasGeometry)
          .map((tool) => ({
            ...tool,
            labelName: segments.appearanceOf(tool.segmentId).name,
          })),
        labels: Object.fromEntries(
          segments.segmentList.value.map((segment) => {
            const resolved = segments.appearanceOf(segment.id);
            return [
              segment.id,
              {
                labelName: resolved.name,
                color: resolved.cssColor,
                strokeWidth: resolved.strokeWidth,
              },
            ];
          })
        ),
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
  const sourceRefContext = (): SourceRefBindingContext => {
    const currentImageId = currentImageID.value ?? undefined;
    const segmentation = currentImageId
      ? segmentationStore.getSegmentationForImage(currentImageId)
      : undefined;
    return {
      activeDataSource: activeDataSource(),
      currentImageId,
      segmentation: segmentation && {
        id: segmentation.id,
        parentImageId: segmentation.parentImageId,
      },
      hasFinishedAnnotations: finishedAnnotationCount.value > 0,
    };
  };

  // The literal 'seg.nrrd' name is required for segment names and colors to be
  // embedded in the serialized output.
  const stageSegmentationInput = async (
    p: ProcessingProvider,
    plan: ReturnType<typeof planSegmentationInput>
  ): Promise<string[]> => {
    const parentImage = plan.parentId;
    const snapshot = captureLabelmapParts(parentImage, plan.parts);
    const referenceImage = mintInputValue(
      datasetStore.getDataSource(parentImage)
    );
    if (!referenceImage) {
      throw new Error('Segmentation reference image has no server provenance');
    }
    const uris: string[] = [];
    for (const [index, part] of snapshot.parts.entries()) {
      const { labelmap, segments } = composeLabelmapPart(snapshot.parent, part);
      const serialized = await writeSegmentation(
        'seg.nrrd',
        labelmap,
        segments
      );
      const staged = await p.stageInput({
        file: new Blob([serialized]),
        descriptor: {
          type: TYPE_TAG_LABELMAP,
          name: layerFileName(plan.name, 'seg.nrrd', index),
          referenceImage: { ...referenceImage, type: 'image' },
        },
      });
      uris.push(...staged);
    }
    return uris;
  };

  // Returns only the parameters it staged, so the caller owns the merge.
  const stageLabelmapInputs = async (
    p: ProcessingProvider,
    bindings: SourceRefBindings,
    model: TaskFormModel
  ): Promise<Record<string, ProcessingValue>> => {
    useSegmentationEditsStore().beforeRead();
    const staged: Record<string, ProcessingValue> = {};
    for (const [parameterId, segmentationId] of Object.entries(
      bindings.labelmap.segmentations
    )) {
      const plan = planSegmentationInput(
        segmentationId,
        acceptsMultipleLabelmaps(model, parameterId)
      );
      const uris = await stageSegmentationInput(p, plan);
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
