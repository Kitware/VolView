// Apply the declarative result intents produced by a finished provider job.
//
// Results cross the wire as a declarative `ResultIntent` the server emits —
// never a store-method name, never a closed `role` enum. A single client-side
// applier maps each intent to the store calls that perform it. The producer
// names no client method; the intent vocabulary is the whole contract.
//
// Additive-only: every intent creates NEW objects — it never mutates or
// overwrites a user-editable one. `add-segment-group` adds a new segment group
// (through the same state-file restore path VolView session-restore uses:
// `convertImageToLabelmap` -> `addLabelmap`), `add-layer`/`add-base-image` add
// new datasets/layers.
//
// Missing, unknown, and malformed intents cause no VolView state action.
//
// Intent -> store call:
//   `add-base-image`     -> loadUrls (new top-level dataset)
//   `add-layer`          -> useLayersStore.addLayer (new layer)
//   `add-segment-group`  -> convertImageToLabelmap (new segment group) + descriptors
//   `restore-state`      -> loadUrls (no dedicated session restore yet)
//   <missing/unknown/invalid> -> no state action
//
// Result auto-load. Plain image results open
// as new top-level datasets. Segment-group results apply as NORMAL,
// born-persistent groups when the originating parent image still exists.

import {
  type KnownResultIntent,
  type SegmentDescriptor,
} from '@/backend-contract';
import type {
  ProcessingResult,
  SubmittedJobContext,
} from '@/src/processing/types';
import { resultToIntent } from '@/src/processing/engine';
import { uriToDataSource } from '@/src/io/import/dataSource';
import {
  importDataSources,
  toDataSelection,
} from '@/src/io/import/importDataSources';
import { isVolumeResult } from '@/src/io/import/common';
import { useDatasetStore } from '@/src/store/datasets';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useJobResultReviewStore } from '@/src/processing/jobResultReview';
import { useMessageStore } from '@/src/store/messages';
import { loadUrls } from '@/src/actions/loadUserFiles';

type ResultFile = { url: string; name: string };

type SegmentGroupIntent = Extract<
  KnownResultIntent,
  { intent: 'add-segment-group' }
>;
export type ApplyIntentOutcome =
  | {
      status: 'applied';
      bindings: { datasetIds: string[]; segmentGroupIds: string[] };
    }
  | { status: 'ignored'; reason: string }
  | { status: 'failed'; error: unknown };

async function loadAsImport(file: ResultFile) {
  const ds = uriToDataSource(file.url, file.name);
  const importResults = await importDataSources([ds]);
  const loaded = importResults
    .filter((r) => r.type === 'data')
    .filter(isVolumeResult);
  return loaded[0] ? toDataSelection(loaded[0]) : null;
}

/**
 * Apply provider-supplied segment descriptors to a specific created group. Run
 * synchronously after `convertImageToLabelmap` resolves (which now awaits its
 * per-component adds, so the id is live).
 */
function applySegmentDescriptors(
  segmentGroupID: string,
  segments: SegmentDescriptor[]
) {
  const segmentGroupStore = useSegmentGroupStore();
  segments.forEach((seg) => {
    try {
      segmentGroupStore.updateSegment(segmentGroupID, seg.value, {
        name: seg.name,
        color: seg.color,
        ...(seg.visible == null ? {} : { visible: seg.visible }),
      });
    } catch (err) {
      // Auto-decoded segment list may not include every value in the
      // labelmap; ignore mismatches.

      console.warn('Failed to apply segment descriptor', seg, err);
    }
  });
}

/**
 * Create a NEW segment group from a loaded child image through the state-file
 * restore path (`convertImageToLabelmap` -> `addLabelmap`) and apply any
 * provider descriptors to the created group(s). Returns the created group id(s).
 *
 * Additive-only: `convertImageToLabelmap` never writes into an existing group,
 * and it threads the `source: {jobId, outputId}` tag through `addLabelmap` so the
 * group round-trips the `.volview.zip` as display provenance. Shared by
 * explicit actions and auto-apply.
 */
async function convertAndDescribe(
  childSelection: string,
  parentSelection: string,
  intent: SegmentGroupIntent
): Promise<string[]> {
  const segmentGroupStore = useSegmentGroupStore();
  const ids = await segmentGroupStore.convertImageToLabelmap(
    childSelection,
    parentSelection,
    intent.source
  );
  // `segments` (folded labels sidecar) is optional; a seg.nrrd with embedded
  // metadata carries none and the group keeps its own decoded segments.
  if (intent.segments?.length) {
    ids.forEach((id) => applySegmentDescriptors(id, intent.segments!));
  }
  return ids;
}

/**
 * The single result applier: map a declarative intent to the store calls that
 * perform it. `add-layer` / `add-segment-group` need an originating dataset to
 * attach to; with none they fall back to opening the file as a new dataset.
 *
 * The action boundary validates untrusted rows once; this applier accepts only
 * the resulting `KnownResultIntent`.
 *
 * Every call has one explicit outcome. Notifications and live-only badges stay
 * with callers.
 */
export async function applyIntent(
  intent: KnownResultIntent,
  context: SubmittedJobContext | undefined
): Promise<ApplyIntentOutcome> {
  const parentSelection = context?.activeDatasetId;
  // Open the result as a new top-level dataset. Also the fallback when a
  // parent-requiring intent has no originating dataset to attach to.
  const openAsDatasetOutcome = async (
    file: ResultFile
  ): Promise<ApplyIntentOutcome> => {
    const datasetIds = await loadUrls({ urls: [file.url], names: [file.name] });
    if (datasetIds.length === 0)
      return { status: 'failed', error: new Error('Result did not load') };
    return { status: 'applied', bindings: { datasetIds, segmentGroupIds: [] } };
  };

  try {
    switch (intent.intent) {
      case 'add-base-image':
      case 'restore-state': {
        return await openAsDatasetOutcome(intent);
      }
      case 'add-layer': {
        if (!parentSelection) {
          return await openAsDatasetOutcome(intent);
        }
        const childSelection = await loadAsImport(intent);
        if (!childSelection)
          return { status: 'failed', error: new Error('Result did not load') };
        // addLayer wraps its build in useErrorMessage, which swallows a throw
        // (e.g. non-intersecting bounds) and resolves to `undefined`. Check the
        // returned id so a failed build reports 'failed' rather than a false
        // 'applied' — matching add-segment-group's explicit failure.
        const layerId = await useLayersStore().addLayer(
          parentSelection,
          childSelection
        );
        if (!layerId) {
          // A successful attach keeps the import because the layer references
          // it; with no layer there is no reference, so the import must not
          // linger as an unintended Data-panel dataset (it would also persist
          // into saved state).
          useDatasetStore().remove(childSelection);
          return {
            status: 'failed',
            error: new Error('Failed to attach layer'),
          };
        }
        return {
          status: 'applied',
          bindings: { datasetIds: [childSelection], segmentGroupIds: [] },
        };
      }
      case 'add-segment-group': {
        if (!parentSelection) {
          return await openAsDatasetOutcome(intent);
        }
        const childSelection = await loadAsImport(intent);
        if (!childSelection)
          return { status: 'failed', error: new Error('Result did not load') };
        try {
          const segmentGroupIds = await convertAndDescribe(
            childSelection,
            parentSelection,
            intent
          );
          return {
            status: 'applied',
            bindings: { datasetIds: [], segmentGroupIds },
          };
        } finally {
          // The imported child was only the conversion vehicle: the created
          // group owns its own derived labelmap image, so the import must not
          // ALSO surface as a Data-panel dataset (nor duplicate into saved
          // state). Same cleanup the session-restore conversion path performs.
          // `add-layer` differs — its layer references the import, so it keeps
          // its dataset.
          useDatasetStore().remove(childSelection);
        }
      }
      default: {
        const exhaustive: never = intent;
        void exhaustive;
        return { status: 'ignored', reason: 'unsupported intent' };
      }
    }
  } catch (error) {
    return { status: 'failed', error };
  }
}

/**
 * Auto-actions on job completion. Plain image outputs are opened as new datasets
 * in the Data panel. Labelmap outputs are applied as new segment groups when the
 * originating parent image still exists. Other intents stay in the Jobs list.
 *
 * Born-persistent: an auto-applied result is a
 * normal deletable object — NO confirm/reject gate, NO promotion state machine.
 * Preview is the existing visibility toggle; reject is the existing delete UI;
 * the only provisional cue is a live-only "new job result" badge (`markNew`).
 *
 * IN-SESSION ONLY: this pipeline serves completions of jobs that finish while
 * the page is open. A job that finished while VolView was closed appears in job
 * history and is applied EXPLICITLY by the user from `JobList.vue` (Open / Add
 * as layer / Add as segment group) through this same `applyIntent` — it is never
 * attached automatically. Exactly-once live delivery is the store's
 * `firedCompletions` seen-set.
 */
export async function autoLoadProcessingResults(
  results: ProcessingResult[],
  context: SubmittedJobContext | undefined
): Promise<void> {
  const review = useJobResultReviewStore();
  for (const result of results) {
    const intent = resultToIntent(result);
    if (!intent) continue;
    const outcome = await applyIntent(intent, context);
    if (outcome.status === 'applied') {
      outcome.bindings.segmentGroupIds.forEach((id) => review.markNew(id));
    } else if (outcome.status === 'failed') {
      // The completion toast already told the user results were ready, so a
      // silent auto-attach failure would leave them staring at nothing. Surface
      // it (this caller owns the message; the applier stays quiet).
      useMessageStore().addError(`Failed to apply ${result.name}`, {
        error: outcome.error instanceof Error ? outcome.error : undefined,
      });
      console.error(
        'Failed to auto-load processing result',
        result,
        outcome.error
      );
    }
  }
}
