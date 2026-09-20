import { getActivePinia, type Pinia } from 'pinia';

// Who points at a segment, declared by the stores that hold references.
//
// The registry knows nothing about masks or shapes: it asks these declarations
// whether a segment is still referenced and hands them the removal. Declarations
// are registered from store setup and scoped to the application instance that
// ran it, so two applications, or two tests, never answer for each other.
// Dependency-free on purpose: a store import here would close a cycle back
// through the registry.

export type SegmentReferenceHolder = {
  has: (segmentId: string) => boolean;
  remove: (segmentId: string) => void;
};

const holdersByApp = new WeakMap<Pinia, Map<string, SegmentReferenceHolder>>();

const holdersOf = () => {
  const pinia = getActivePinia();
  if (!pinia) return undefined;
  const existing = holdersByApp.get(pinia);
  if (existing) return existing;
  const holders = new Map<string, SegmentReferenceHolder>();
  holdersByApp.set(pinia, holders);
  return holders;
};

export function declareSegmentReferences(
  name: string,
  holder: SegmentReferenceHolder
) {
  holdersOf()?.set(name, holder);
}

export const segmentIsReferenced = (segmentId: string) =>
  [...(holdersOf()?.values() ?? [])].some((holder) => holder.has(segmentId));

export const removeSegmentReferences = (segmentId: string) =>
  holdersOf()?.forEach((holder) => holder.remove(segmentId));
