import {
  ANNOTATION_TOOL_KINDS,
  type AnnotationLabel,
  type AnnotationToolKind,
  type KnownResultIntent,
  type ResultSource,
  type SegmentDescriptor,
  type WirePolygon,
  type WireRuler,
} from '@/backend-contract';
import type {
  ProcessingResult,
  SubmittedJobContext,
} from '@/src/processing/types';
import { resultToIntent } from '@/src/processing/engine/resultToIntent';
import {
  decodeAnnotationsFile,
  type DecodedAnnotationsFile,
} from '@/src/processing/engine/annotationsWire';
import { fetchProcessingResult } from '@/src/processing/engine/resultDownload';
import { annotationToolStore } from '@/src/processing/annotationKinds';
import { cleanUndefined, ensureError } from '@/src/utils';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { uriToDataSource } from '@/src/io/import/dataSource';
import {
  importVolumeDataSources,
  toDataSelection,
} from '@/src/io/import/importDataSources';
import { isVolumeResult } from '@/src/io/import/common';
import type { ImageMetadata } from '@/src/types/image';
import type { SegmentMask } from '@/src/types/segment';
import { useDatasetStore } from '@/src/store/datasets';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import { loadVolumeUrls } from '@/src/actions/loadUserFiles';

type ResultFile = { url: string; name: string };

type SegmentGroupIntent = Extract<
  KnownResultIntent,
  { intent: 'add-segment-group' }
>;
type AnnotationsIntent = Extract<
  KnownResultIntent,
  { intent: 'add-annotations' }
>;
export type ApplyIntentOutcome =
  | { status: 'applied' }
  | { status: 'failed'; error: unknown };

const sameResultSource = (
  source: ResultSource | undefined,
  target: ResultSource
): boolean =>
  source?.providerId === target.providerId &&
  source.jobId === target.jobId &&
  source.outputId === target.outputId;

function segmentGroupResultInScene(
  intent: SegmentGroupIntent,
  segmentGroups: SegmentGroupWriter
): boolean {
  const target = intent.source;
  if (!target) return false;
  return segmentGroups
    .resultSourcesInScene()
    .some((source) => sameResultSource(source, target));
}

async function loadAsImport(file: ResultFile) {
  const ds = uriToDataSource(file.url, file.name);
  const importResults = await importVolumeDataSources([ds]);
  const loaded = importResults
    .filter((r) => r.type === 'data')
    .filter(isVolumeResult);
  return loaded[0] ? toDataSelection(loaded[0]) : null;
}

function applySegmentDescriptors(
  segmentGroupID: string,
  segments: SegmentDescriptor[],
  segmentGroups: SegmentGroupWriter
) {
  segments.forEach((seg) => {
    try {
      segmentGroups.updateSegment(segmentGroupID, seg.value, {
        name: seg.name,
        color: seg.color,
        ...(seg.visible == null ? {} : { visible: seg.visible }),
      });
    } catch (err) {
      // Decoded segment list may not cover every value in the labelmap.

      console.warn('Failed to apply segment descriptor', seg, err);
    }
  });
}

async function convertAndDescribe(
  childSelection: string,
  parentSelection: string,
  intent: SegmentGroupIntent,
  segmentGroups: SegmentGroupWriter
): Promise<string[]> {
  const ids = await segmentGroups.convertImageToLabelmap(
    childSelection,
    parentSelection,
    intent.source
  );
  // A seg.nrrd with embedded metadata carries no descriptors.
  if (intent.segments?.length) {
    ids.forEach((id) =>
      applySegmentDescriptors(id, intent.segments!, segmentGroups)
    );
  }
  return ids;
}

// Annotation results are fully decoded and located before labels or tools are
// mutated. Store payloads remain explicit allowlists of decoded fields.

// Session-restored tools retain their result source, so that durable
// provenance doubles as an application receipt: re-Loading a job adds nothing.
function annotationResultInScene(intent: AnnotationsIntent): boolean {
  const target = intent.source;
  if (!target) return false;
  return ANNOTATION_TOOL_KINDS.some((kind) =>
    Object.values(annotationToolStore(kind).toolByID).some(({ source }) =>
      sameResultSource(source, target)
    )
  );
}

type PreparedCore = {
  imageID: string;
  slice: number;
  frameOfReference: WireRuler['frameOfReference'];
  labelName?: string;
  frame?: number;
  name?: string;
  metadata?: Record<string, string>;
};

// Geometry travels as one opaque bag so the code below never re-branches on
// kind: only the store the bag is handed to knows its shape, and the kind table
// is what pairs the two.
type PreparedGeometry =
  | Pick<WireRuler, 'firstPoint' | 'secondPoint'>
  | Pick<WirePolygon, 'points'>;

type PreparedTool = PreparedCore & { geometry: PreparedGeometry };

type PreparedAnnotations = Record<AnnotationToolKind, PreparedTool[]>;

// Frame count of a cine target, or null for a static volume. Reads the same
// record `isCineImage` keys on; for 'cine', NumberOfSlices is the frame count.
const cineFrameCountFor = (imageID: string): number | null => {
  const info = useDICOMStore().volumeInfo[imageID];
  return info?.kind === 'cine' ? info.NumberOfSlices : null;
};

/**
 * A stored `frame` flips a tool into cine semantics everywhere (render slice,
 * visibility, jump-to drives playback), so its validity depends on the TARGET
 * image, not the producer. It stays an advisory echo the client never trusts:
 * on a static volume it is dropped, and on a cine image a frame the clip does
 * not have is dropped too, leaving the tool on every frame — the same place an
 * absent frame puts it.
 */
const prepareFrame = (
  frame: number | undefined,
  cineFrameCount: number | null
): number | undefined => {
  if (cineFrameCount == null || frame == null) return undefined;
  const inClip =
    Number.isInteger(frame) && frame >= 0 && frame < cineFrameCount;
  return inClip ? frame : undefined;
};

/**
 * Locate a wire frame of reference on THIS image, or say why it cannot be.
 * Out-of-bounds slices are accepted, matching what the renderer already places;
 * an oblique plane and a plane between slices are both unrenderable, and they
 * are distinguished so the failure names its own cause.
 */
const locateAnnotationPlane = (
  frameOfReference: WireRuler['frameOfReference'],
  imageMetadata: ImageMetadata
): { slice: number } => {
  const located = frameOfReferenceToImageSliceAndAxis(
    frameOfReference,
    imageMetadata,
    { allowOutOfBoundsSlice: true }
  );
  if (located) return located;
  // Only the non-integral slice is forgiven by the second probe, so an answer
  // here means the plane was axis-aligned all along.
  const alignedButBetweenSlices = frameOfReferenceToImageSliceAndAxis(
    frameOfReference,
    imageMetadata,
    { allowOutOfBoundsSlice: true, allowNonIntegralSlice: true }
  );
  throw new Error(
    alignedButBetweenSlices
      ? 'Annotation plane falls between slices of the input image'
      : 'Annotation plane is not aligned to an axis of the input image'
  );
};

/**
 * Project one decoded wire tool onto the store's core fields, rejecting the
 * whole result if it cannot be placed. `wire.slice` is advisory: the slice is
 * re-derived from the frame of reference against THIS image, and a plane no
 * slice of that image lies on cannot be rendered — no `slice` fallback can
 * make it otherwise.
 */
const prepareCore = (
  tool: WireRuler | WirePolygon,
  imageID: string,
  imageMetadata: ImageMetadata,
  cineFrameCount: number | null
): PreparedCore => {
  const located = locateAnnotationPlane(tool.frameOfReference, imageMetadata);
  return {
    imageID,
    slice: located.slice,
    frameOfReference: tool.frameOfReference,
    ...cleanUndefined({
      labelName: tool.labelName || undefined,
      frame: prepareFrame(tool.frame, cineFrameCount),
      name: tool.name,
      metadata: tool.metadata,
    }),
  };
};

const wireGeometry = (tool: WireRuler | WirePolygon): PreparedGeometry =>
  'points' in tool
    ? { points: tool.points }
    : { firstPoint: tool.firstPoint, secondPoint: tool.secondPoint };

const prepareAnnotations = (
  decoded: DecodedAnnotationsFile,
  imageID: string,
  imageMetadata: ImageMetadata,
  cineFrameCount: number | null
): PreparedAnnotations =>
  Object.fromEntries(
    ANNOTATION_TOOL_KINDS.map((kind) => [
      kind,
      decoded.tools[kind].map((tool) => ({
        geometry: wireGeometry(tool),
        ...prepareCore(tool, imageID, imageMetadata, cineFrameCount),
      })),
    ])
  ) as PreparedAnnotations;

// Label identity across the boundary is the NAME, inside its own tool-kind
// namespace: merging returns the store id a tool must point at. Only names the
// tools actually reference are merged — a declaration nothing uses would be
// clutter in the label picker.
const mergeReferencedLabels = (
  kind: AnnotationToolKind,
  tools: readonly PreparedCore[],
  namespace: Record<string, AnnotationLabel>
): Record<string, string> => {
  const store = annotationToolStore(kind);
  const names = new Set(
    tools.flatMap((tool) => (tool.labelName ? [tool.labelName] : []))
  );
  // A merge that lands on a new name adds a label, and adding one activates it.
  // Applying a result is not the user picking a label, so the picker is put back.
  const activeBefore = store.activeLabel;
  const ids = Object.fromEntries(
    [...names].map((labelName) => [
      labelName,
      store.mergeLabel({ labelName, ...(namespace[labelName] ?? {}) }),
    ])
  );
  store.setActiveLabel(activeBefore);
  return ids;
};

// `labelName` is deliberately NOT passed through: addTool re-derives it from
// the label id, and passing a name without an id would silently blank it.
const toolPayload = (
  { labelName, ...core }: PreparedCore,
  labelIds: Record<string, string>,
  source: ResultSource | undefined
) => ({
  ...core,
  label: (labelName && labelIds[labelName]) || '',
  ...(source ? { source } : {}),
});

async function applyAnnotations(
  intent: AnnotationsIntent,
  parentSelection: string | undefined,
  fetchResult: FetchProcessingResult
): Promise<ApplyIntentOutcome> {
  if (annotationResultInScene(intent)) return { status: 'applied' };

  // Tools are anchored to an image; without one they would be orphans the UI
  // never shows. Opening the file as a dataset is not a fallback either — it is
  // not an image.
  const imageMetadata = parentSelection
    ? useImageCacheStore().getImageMetadata(parentSelection)
    : null;
  if (!parentSelection || !imageMetadata) {
    return {
      status: 'failed',
      error: new Error(
        "Load the job's input image before applying annotations"
      ),
    };
  }

  const file = await fetchResult({
    id: intent.id,
    name: intent.name,
    url: intent.url,
  });
  const decoded = decodeAnnotationsFile(JSON.parse(await file.text()));

  const prepared = prepareAnnotations(
    decoded,
    parentSelection,
    imageMetadata,
    cineFrameCountFor(parentSelection)
  );
  // A task that found nothing to annotate succeeded; there is just no state to add.
  if (ANNOTATION_TOOL_KINDS.every((kind) => prepared[kind].length === 0)) {
    return { status: 'applied' };
  }

  // Labels first for every kind, then the tools: a tool points at the store id
  // its label merged to.
  const labelIds = Object.fromEntries(
    ANNOTATION_TOOL_KINDS.map((kind) => [
      kind,
      mergeReferencedLabels(kind, prepared[kind], decoded.labels[kind]),
    ])
  ) as Record<AnnotationToolKind, Record<string, string>>;

  ANNOTATION_TOOL_KINDS.forEach((kind) => {
    const store = annotationToolStore(kind);
    prepared[kind].forEach(({ geometry, ...core }) => {
      // Held in a local so the geometry reaches the store: the registry's
      // uniform tool type does not carry the per-kind geometry keys.
      const payload = {
        ...geometry,
        ...toolPayload(core, labelIds[kind], intent.source),
      };
      store.addTool(payload);
    });
  });

  return { status: 'applied' };
}

type FetchProcessingResult = typeof fetchProcessingResult;

type SegmentGroupWriter = {
  /** Result provenance of every segment group in the scene, in scene order. */
  resultSourcesInScene: () => Array<ResultSource | undefined>;
  convertImageToLabelmap: (
    childSelection: string,
    parentSelection: string,
    source: ResultSource | undefined
  ) => Promise<string[]>;
  updateSegment: (
    segmentGroupID: string,
    segmentValue: number,
    segmentUpdate: Partial<Omit<SegmentMask, 'value'>>
  ) => void;
};

/**
 * The download, import and scene-mutation edges, so a caller can drive the
 * intent routing without a loaded scene behind it.
 */
export type ApplyDependencies = {
  fetchResult: FetchProcessingResult;
  openVolumeUrls: typeof loadVolumeUrls;
  importVolume: (file: ResultFile) => Promise<string | null>;
  removeDataset: (selection: string) => void;
  addLayer: (
    parentSelection: string,
    childSelection: string
  ) => Promise<string | undefined>;
  segmentGroups: SegmentGroupWriter;
};

export const appApplyDependencies = (): ApplyDependencies => ({
  fetchResult: fetchProcessingResult,
  openVolumeUrls: loadVolumeUrls,
  importVolume: loadAsImport,
  removeDataset: (selection) => useDatasetStore().remove(selection),
  addLayer: (parentSelection, childSelection) =>
    useLayersStore().addLayer(parentSelection, childSelection),
  segmentGroups: {
    resultSourcesInScene: () =>
      Object.values(useSegmentGroupStore().metadataByID).map(
        ({ source }) => source
      ),
    convertImageToLabelmap: (childSelection, parentSelection, source) =>
      useSegmentGroupStore().convertImageToLabelmap(
        childSelection,
        parentSelection,
        source
      ),
    updateSegment: (segmentGroupID, segmentValue, segmentUpdate) =>
      useSegmentGroupStore().updateSegment(
        segmentGroupID,
        segmentValue,
        segmentUpdate
      ),
  },
});

export async function applyIntent(
  intent: KnownResultIntent,
  context: SubmittedJobContext | undefined,
  dependencies: ApplyDependencies = appApplyDependencies()
): Promise<ApplyIntentOutcome> {
  const parentSelection = context?.activeDatasetId;
  const openVolumeAsDatasetOutcome = async (
    file: ResultFile
  ): Promise<ApplyIntentOutcome> => {
    const datasetIds = await dependencies.openVolumeUrls({
      urls: [file.url],
      names: [file.name],
    });
    if (datasetIds.length === 0)
      return { status: 'failed', error: new Error('Result did not load') };
    return { status: 'applied' };
  };

  try {
    switch (intent.intent) {
      case 'add-base-image': {
        return await openVolumeAsDatasetOutcome(intent);
      }
      case 'add-layer': {
        if (!parentSelection) {
          return await openVolumeAsDatasetOutcome(intent);
        }
        const childSelection = await dependencies.importVolume(intent);
        if (!childSelection)
          return { status: 'failed', error: new Error('Result did not load') };
        // addLayer swallows build failures and resolves undefined, so the id is the only failure signal.
        const layerId = await dependencies.addLayer(
          parentSelection,
          childSelection
        );
        if (!layerId) {
          dependencies.removeDataset(childSelection);
          return {
            status: 'failed',
            error: new Error('Failed to attach layer'),
          };
        }
        return { status: 'applied' };
      }
      case 'add-segment-group': {
        // Session-restored groups retain their result source. Treat that
        // durable provenance as an application receipt so retrying Load is
        // idempotent instead of creating a duplicate group.
        if (segmentGroupResultInScene(intent, dependencies.segmentGroups))
          return { status: 'applied' };
        if (!parentSelection) {
          return await openVolumeAsDatasetOutcome(intent);
        }
        const childSelection = await dependencies.importVolume(intent);
        if (!childSelection)
          return { status: 'failed', error: new Error('Result did not load') };
        try {
          await convertAndDescribe(
            childSelection,
            parentSelection,
            intent,
            dependencies.segmentGroups
          );
          return { status: 'applied' };
        } finally {
          // The group owns its own labelmap image; the import was only a vehicle.
          dependencies.removeDataset(childSelection);
        }
      }
      case 'add-annotations': {
        return await applyAnnotations(
          intent,
          parentSelection,
          dependencies.fetchResult
        );
      }
      default: {
        const exhaustive: never = intent;
        void exhaustive;
        return {
          status: 'failed',
          error: new Error('Unsupported result intent'),
        };
      }
    }
  } catch (error) {
    return { status: 'failed', error };
  }
}

export async function autoLoadProcessingResults(
  results: ProcessingResult[],
  context: SubmittedJobContext | undefined,
  dependencies: ApplyDependencies = appApplyDependencies()
): Promise<{ failedResultIds: string[] }> {
  const failedResultIds: string[] = [];
  for (const result of results) {
    const intent = resultToIntent(result);
    if (!intent) continue;
    const outcome = await applyIntent(intent, context, dependencies);
    if (outcome.status === 'failed') {
      failedResultIds.push(result.id);
      // The completion toast already promised results.
      useMessageStore().addError(`Failed to apply ${result.name}`, {
        error: ensureError(outcome.error),
      });
      console.error(
        'Failed to auto-load processing result',
        result,
        outcome.error
      );
    }
  }
  return { failedResultIds };
}
