import { getActivePinia, type Pinia } from 'pinia';

// Who points at a segment type, declared by the stores that hold references.
//
// The registry knows nothing about masks or shapes: it asks these declarations
// whether a type is still referenced and hands them the removal. Declarations
// are registered from store setup and scoped to the application instance that
// ran it, so two applications, or two tests, never answer for each other.
// Dependency-free on purpose: a store import here would close a cycle back
// through the registry.

export type SegmentTypeReferenceHolder = {
  has: (typeId: string) => boolean;
  remove: (typeId: string) => void;
};

const holdersByApp = new WeakMap<
  Pinia,
  Map<string, SegmentTypeReferenceHolder>
>();

const holdersOf = () => {
  const pinia = getActivePinia();
  if (!pinia) return undefined;
  const existing = holdersByApp.get(pinia);
  if (existing) return existing;
  const holders = new Map<string, SegmentTypeReferenceHolder>();
  holdersByApp.set(pinia, holders);
  return holders;
};

export function declareSegmentTypeReferences(
  name: string,
  holder: SegmentTypeReferenceHolder
) {
  holdersOf()?.set(name, holder);
}

export const segmentTypeIsReferenced = (typeId: string) =>
  [...(holdersOf()?.values() ?? [])].some((holder) => holder.has(typeId));

export const removeSegmentTypeReferences = (typeId: string) =>
  holdersOf()?.forEach((holder) => holder.remove(typeId));
