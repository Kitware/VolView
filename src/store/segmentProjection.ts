import { computed } from 'vue';

import type { SegmentRegistry } from '@/src/store/tools/segmentRegistry';
import { sameLabelmapSegments, toLabelmapSegment } from '@/src/types/segment';
import {
  listMasks,
  type ArtifactMetadata,
  type LabelmapSegment,
  type Segmentation,
} from '@/src/types/segmentation';

/** What the projection needs from the store that owns the records. */
export type SegmentProjectionDeps = {
  segmentations: Record<string, Segmentation>;
  artifactMeta: Record<string, ArtifactMetadata>;
  segmentRegistry: SegmentRegistry;
};

/**
 * The value-keyed projection the labelmap renderer colors by, one list per
 * artifact. Any change to any segment rebuilds it, but an artifact whose own
 * list is unchanged keeps its previous array: a representation reads one
 * artifact's entry, and a fresh array there costs it a transfer function and
 * label outline table rebuild in every view it draws in.
 */
export function createSegmentProjection({
  segmentations,
  artifactMeta,
  segmentRegistry,
}: SegmentProjectionDeps) {
  function project() {
    const byArtifact: Record<string, LabelmapSegment[]> = {};
    Object.keys(artifactMeta).forEach((artifactId) => {
      byArtifact[artifactId] = [];
    });
    Object.values(segmentations).forEach((segmentation) => {
      listMasks(segmentation).forEach((segment) => {
        const binding = segment.representations.labelmap;
        if (!binding || !byArtifact[binding.artifactId]) return;
        byArtifact[binding.artifactId].push(
          toLabelmapSegment(
            segmentRegistry.getSegment(segment.segmentId),
            binding.labelValue
          )
        );
      });
    });
    return byArtifact;
  }

  let projected: Record<string, LabelmapSegment[]> = {};

  return computed(() => {
    const fresh = project();
    const stable = Object.fromEntries(
      Object.entries(fresh).map(([artifactId, list]) => {
        const previous = projected[artifactId];
        return [
          artifactId,
          sameLabelmapSegments(previous, list) ? previous : list,
        ];
      })
    );
    // The record's own identity is what a consumer of the whole projection
    // watches, so it survives a change that left every artifact alone.
    const unchanged =
      Object.keys(stable).length === Object.keys(projected).length &&
      Object.entries(stable).every(([id, list]) => projected[id] === list);
    if (!unchanged) projected = stable;
    return projected;
  });
}
