import { resultToIntent } from '@/src/processing/engine/resultToIntent';
import type { ProcessingResult } from '@/src/processing/types';

/**
 * The results Load can put in the scene — the ones carrying a known intent.
 *
 * A job's other outputs (reports, tables, logs) are ordinary files: the backend
 * emits them with no state directive, so the single applier has nothing to do
 * with them and they are retrievable only by download.
 */
export const sceneApplicableResults = (
  results: ProcessingResult[]
): ProcessingResult[] => results.filter((result) => !!resultToIntent(result));

/**
 * Whether to offer Load for a job whose fetched result list is `results`.
 *
 * `undefined` means the list has not been fetched yet: the answer is unknown,
 * so Load stays offered rather than hidden on a guess. Once the list is known,
 * a job with no scene-applicable output (a report-only task) drops the button
 * instead of leaving a control that can only dead-end.
 */
export const offersSceneLoad = (
  results: ProcessingResult[] | undefined
): boolean =>
  results === undefined || sceneApplicableResults(results).length > 0;
