// Live-session review state for auto-shown job results.
//
// A validated result is BORN-PERSISTENT: it is applied as a NORMAL, deletable
// segment group governed by the EXISTING visibility/delete UI — there is NO
// confirm/reject state machine and NO promotion field on the group. Deletability
// alone answers "no undo". The only review cue is a COSMETIC, LIVE-SESSION-ONLY
// badge ("new job result") on the freshly-attached group; this store holds
// exactly that badge set and nothing else.
//
// Deliberately NOT serialized — it never enters the `.volview.zip` (the badge is
// live-only). A page reload starts with an empty set. A re-discovered group is
// badged only when it is FRESHLY re-attached; a session-restored group is skipped
// by the scene-state idempotency guard in the applier, so it is never re-badged.
//
// House rules: functional style; `type`, not `interface`.

import { defineStore } from 'pinia';
import { reactive } from 'vue';

import { useSegmentGroupStore } from '@/src/store/segmentGroups';

export const useJobResultReviewStore = defineStore('jobResultReview', () => {
  // Segment-group ids freshly auto-shown from a job result THIS session. A
  // reactive Set so the badge in SegmentGroupControls reacts to mark/dismiss.
  const newResultGroupIds = reactive(new Set<string>());

  // Badge a freshly auto-shown result group as new (the provisional review cue).
  const markNew = (id: string) => {
    newResultGroupIds.add(id);
  };

  // Drop the badge — e.g. the group was deleted, or the user acknowledged the
  // cue. Dismissing the badge NEVER deletes the group; the group is a normal
  // object and outlives its badge.
  const dismiss = (id: string) => {
    newResultGroupIds.delete(id);
  };

  const isNew = (id: string) => newResultGroupIds.has(id);

  const clear = () => {
    newResultGroupIds.clear();
  };

  // Layering inversion (dependency points feature → core, never the reverse):
  // core `store/segmentGroups` must not import this feature store, so the
  // dismiss-on-removal wiring lives HERE. Subscribe to the segment-group store
  // and clear a group's badge after ANY removal path runs `removeGroup` — the
  // delete UI, the onImageDeleted cascade, and programmatic callers alike. The
  // tradeoff is acceptable: a badge only exists once THIS store is
  // instantiated, and instantiating it is exactly what installs this hook.
  useSegmentGroupStore().$onAction(({ name, args, after }) => {
    if (name === 'removeGroup') after(() => dismiss(args[0] as string));
  });

  return { newResultGroupIds, markNew, dismiss, isNew, clear };
});
