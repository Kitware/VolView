// Manifest-reference declarations for the remove-cascade save backstop.
//
// Every store that keeps dataset/view/segment-group-keyed manifest state clean
// via a remove cascade (an `onImageDeleted` registration or an equivalent sync
// watch) also declares, at module scope next to that cascade, how to find its
// references in a save manifest. The dev-only backstop in
// `io/state-file/serialize.ts` walks these declarations, so the checker's
// coverage is defined by the same modules that own the cascades and the two
// cannot drift apart.
//
// This module is deliberately dependency-free: declarations run at module
// evaluation from store modules, and any import here could turn that into a
// cycle.

export type ManifestRefKind = 'dataset' | 'segmentGroup' | 'view';

export type ManifestRef = {
  kind: ManifestRefKind;
  id: string;
  // Human-readable location for the warning message, e.g. `tools.crop[abc]`.
  where: string;
};

type ManifestRefCollector = (
  manifest: Record<string, unknown>
) => ManifestRef[];

// Keyed by name so repeated module evaluation stays idempotent.
const manifestRefCollectors = new Map<string, ManifestRefCollector>();

export function declareManifestRefs(
  name: string,
  collect: ManifestRefCollector
) {
  manifestRefCollectors.set(name, collect);
}

export function collectManifestRefs(manifest: Record<string, unknown>) {
  return [...manifestRefCollectors.values()].flatMap((collect) =>
    collect(manifest)
  );
}
