import {
  type KnownResultIntent,
  type SegmentDescriptor,
} from '@/backend-contract';
import type {
  ProcessingResult,
  SubmittedJobContext,
} from '@/src/processing/types';
import { resultToIntent } from '@/src/processing/engine/resultToIntent';
import { ensureError } from '@/src/utils';
import { uriToDataSource } from '@/src/io/import/dataSource';
import {
  importVolumeDataSources,
  toDataSelection,
} from '@/src/io/import/importDataSources';
import { isVolumeResult } from '@/src/io/import/common';
import { useDatasetStore } from '@/src/store/datasets';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useMessageStore } from '@/src/store/messages';
import { loadVolumeUrls } from '@/src/actions/loadUserFiles';

type ResultFile = { url: string; name: string };

type SegmentGroupIntent = Extract<
  KnownResultIntent,
  { intent: 'add-segment-group' }
>;
export type ApplyIntentOutcome =
  | { status: 'applied' }
  | { status: 'failed'; error: unknown };

function segmentGroupResultInScene(intent: SegmentGroupIntent): boolean {
  const target = intent.source;
  if (!target) return false;
  return Object.values(useSegmentGroupStore().metadataByID).some(
    ({ source }) =>
      source?.providerId === target.providerId &&
      source.jobId === target.jobId &&
      source.outputId === target.outputId
  );
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
      // Decoded segment list may not cover every value in the labelmap.

      console.warn('Failed to apply segment descriptor', seg, err);
    }
  });
}

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
  // A seg.nrrd with embedded metadata carries no descriptors.
  if (intent.segments?.length) {
    ids.forEach((id) => applySegmentDescriptors(id, intent.segments!));
  }
  return ids;
}

export async function applyIntent(
  intent: KnownResultIntent,
  context: SubmittedJobContext | undefined
): Promise<ApplyIntentOutcome> {
  const parentSelection = context?.activeDatasetId;
  const openVolumeAsDatasetOutcome = async (
    file: ResultFile
  ): Promise<ApplyIntentOutcome> => {
    const datasetIds = await loadVolumeUrls({
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
        const childSelection = await loadAsImport(intent);
        if (!childSelection)
          return { status: 'failed', error: new Error('Result did not load') };
        // addLayer swallows build failures and resolves undefined, so the id is the only failure signal.
        const layerId = await useLayersStore().addLayer(
          parentSelection,
          childSelection
        );
        if (!layerId) {
          useDatasetStore().remove(childSelection);
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
        if (segmentGroupResultInScene(intent)) return { status: 'applied' };
        if (!parentSelection) {
          return await openVolumeAsDatasetOutcome(intent);
        }
        const childSelection = await loadAsImport(intent);
        if (!childSelection)
          return { status: 'failed', error: new Error('Result did not load') };
        try {
          await convertAndDescribe(childSelection, parentSelection, intent);
          return { status: 'applied' };
        } finally {
          // The group owns its own labelmap image; the import was only a vehicle.
          useDatasetStore().remove(childSelection);
        }
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
  context: SubmittedJobContext | undefined
): Promise<{ failedResultIds: string[] }> {
  const failedResultIds: string[] = [];
  for (const result of results) {
    const intent = resultToIntent(result);
    if (!intent) continue;
    const outcome = await applyIntent(intent, context);
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
