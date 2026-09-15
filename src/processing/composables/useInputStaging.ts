import { computed } from 'vue';

import {
  segmentationFileStem,
  writeLabelmapParts,
} from '@/src/segmentation/io/export';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { planSegmentationInput } from '@/src/processing/segmentationInput';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDatasetStore } from '@/src/store/datasets';
import { useSegmentationStore } from '@/src/segmentation/store';
import { segmentationHasContent } from '@/src/segmentation/model';
import { useSegmentStore } from '@/src/segmentation/segments';
import { resolveSegmentAppearance } from '@/src/segmentation/segment';
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

  // The segment's name travels with each tool: identity on the wire is the
  // name, and the encoder prunes the shared labels per kind by it.
  const annotationToolsView = computed(() => {
    const registry = useSegmentStore().segments;
    const labels = Object.fromEntries(
      registry.segmentList.value.map((segment) => {
        const { name, cssColor, strokeWidth } =
          resolveSegmentAppearance(segment);
        return [segment.id, { labelName: name, color: cssColor, strokeWidth }];
      })
    );
    const kindView = <T extends object>(
      kind: AnnotationToolKind,
      hasGeometry: <U extends AnnotationTool>(tool: U) => tool is U & T
    ): AnnotationKindView<AnnotationTool & T> => ({
      tools: onActiveImage(annotationToolStore(kind).finishedTools)
        .filter(hasGeometry)
        .map((tool) => ({
          ...tool,
          labelName: registry.getSegment(tool.segmentId)?.name,
        })),
      labels,
    });
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
    const currentImageId = currentImageID.value;
    const record = currentImageId
      ? segmentationStore.getSegmentationForImage(currentImageId)
      : undefined;
    // A record whose masks hold no voxel would stage an all-background file,
    // so it is not an input at all: the binder falls to its own
    // 'no-segmentation' branch, and staging never sees the parameter. Display
    // settings, deleting the last segment and a result that declared only empty
    // segments all leave such a record behind.
    return {
      activeDataSource: activeDataSource(),
      segmentationId:
        record && segmentationHasContent(record) ? record.id : undefined,
      hasFinishedAnnotations: finishedAnnotationCount.value > 0,
    };
  };

  // The literal 'seg.nrrd' name is required for segment names and colors to be
  // embedded in the serialized output.
  const stageSegmentationInput = async (
    p: ProcessingProvider,
    plan: ReturnType<typeof planSegmentationInput>
  ): Promise<string[]> => {
    const referenceImage = mintInputValue(
      datasetStore.getDataSource(plan.parentId)
    );
    if (!referenceImage) {
      throw new Error('Segmentation reference image has no server provenance');
    }
    const uris: string[] = [];
    await writeLabelmapParts(
      plan,
      segmentationFileStem(plan.parentId, plan.name),
      'seg.nrrd',
      async ({ name, data }) => {
        const staged = await p.stageInput({
          file: new Blob([data]),
          descriptor: {
            type: TYPE_TAG_LABELMAP,
            name,
            referenceImage: { ...referenceImage, type: 'image' },
          },
        });
        uris.push(...staged);
      }
    );
    return uris;
  };

  // Returns only the parameters it staged, so the caller owns the merge.
  const stageLabelmapInputs = async (
    p: ProcessingProvider,
    bindings: SourceRefBindings
  ): Promise<Record<string, ProcessingValue>> => {
    const requests = Object.entries(bindings.labelmap.segmentations);
    // Reading committed voxels resolves an unconfirmed preview, so a task that
    // takes no labelmap must not ask for the read and discard the preview.
    if (!requests.length) return {};
    useSegmentationEditsStore().beforeRead();
    const staged: Record<string, ProcessingValue> = {};
    for (const [parameterId, { segmentationId, multiple }] of requests) {
      const plan = planSegmentationInput(segmentationId, multiple);
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
