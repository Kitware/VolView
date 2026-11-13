import type { InstanceFacts } from './planDicomCollections';

const anonymousKeys = new WeakMap<InstanceFacts, string>();
let nextAnonymousKey = 0;

// Instance facts are cached for the lifetime of their metadata. Object identity
// survives replanning without retaining discarded facts, and the prefix cannot
// be a DICOM UID, whose alphabet contains only digits and dots.
export const instanceKey = (instance: InstanceFacts) => {
  if (instance.sopInstanceUid !== null) return instance.sopInstanceUid;
  const existing = anonymousKeys.get(instance);
  if (existing) return existing;
  const created = `anonymous:${nextAnonymousKey++}`;
  anonymousKeys.set(instance, created);
  return created;
};
