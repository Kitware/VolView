import type { Vector3 } from '@kitware/vtk.js/types';
import type { LPSAxis } from '@/src/types/lps';
import type { AnnotationTool } from '@/src/types/annotation-tool';
import type { FrameOfReference } from '@/src/utils/frameOfReference';
import {
  AXIAL_FRAME_OF_REFERENCE,
  frameOfReferenceToImageSliceAndAxis,
} from '@/src/utils/frameOfReference';
import { Maybe } from '@/src/types';
import { useImage } from '@/src/composables/useCurrentImage';
import { useViewStore } from '@/src/store/views';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import useCinePlaybackStore from '@/src/store/view-configs/cine-playback';
import {
  computeEffectiveView,
  getEffectiveView,
  EffectiveView,
  volume2DViewsOfImage,
} from '@/src/core/views/effectiveView';

type Locator =
  | { kind: 'none' }
  | {
      kind: 'spatial';
      slice: number;
      axis: LPSAxis;
      frameOfReference: FrameOfReference;
    }
  | { kind: 'temporal'; frame: number };

type LocatorFields = Pick<
  AnnotationTool,
  'slice' | 'frameOfReference' | 'frame'
>;

export function viewLocator(
  effective: EffectiveView | null,
  cursors: {
    slice?: number;
    axis?: LPSAxis;
    frameOfReference?: FrameOfReference;
    frame?: number;
  }
): Locator {
  if (!effective) return { kind: 'none' };
  if (effective.kind === 'cine') {
    if (cursors.frame == null) return { kind: 'none' };
    return { kind: 'temporal', frame: cursors.frame };
  }
  if (effective.kind === 'volume2D') {
    if (cursors.slice == null || !cursors.axis || !cursors.frameOfReference)
      return { kind: 'none' };
    return {
      kind: 'spatial',
      slice: cursors.slice,
      axis: cursors.axis,
      frameOfReference: cursors.frameOfReference,
    };
  }
  return { kind: 'none' };
}

export function locatorPatch(here: Locator): LocatorFields {
  switch (here.kind) {
    case 'spatial':
      return { slice: here.slice, frameOfReference: here.frameOfReference };
    case 'temporal':
      return {
        slice: 0,
        frameOfReference: AXIAL_FRAME_OF_REFERENCE,
        frame: here.frame,
      };
    case 'none':
      return {
        slice: -1,
        frameOfReference: {
          planeOrigin: [0, 0, 0] as Vector3,
          planeNormal: [1, 0, 0] as Vector3,
        },
      };
  }
}

// Render-plane slice for a widget's plane manipulator. Cine annotations render
// on the single 2D frame at z=0; volume annotations may pin to their own
// slice, otherwise follow the view.
export function toolRenderSlice(
  tool: Maybe<Pick<AnnotationTool, 'slice' | 'frame'>>,
  viewSlice: Maybe<number>
): number {
  if (!tool) return viewSlice ?? 0;
  if (tool.frame != null) return 0;
  return tool.slice ?? viewSlice ?? 0;
}

function revealCineFrame(imageID: string, frame: number) {
  const activeView = useViewStore().activeView;
  const effective = getEffectiveView(activeView);
  if (
    !activeView ||
    effective?.kind !== 'cine' ||
    effective.renderDataID !== imageID
  )
    return;
  useCinePlaybackStore().updateConfig(activeView, imageID, { frame });
}

export function applyLocator(imageID: string, tool: AnnotationTool) {
  const viewStore = useViewStore();

  if (tool.frame != null) {
    revealCineFrame(imageID, tool.frame);
    return;
  }

  const { metadata } = useImage(imageID);
  const toolImageFrame = frameOfReferenceToImageSliceAndAxis(
    tool.frameOfReference,
    metadata.value,
    { allowOutOfBoundsSlice: true }
  );
  if (!toolImageFrame) return;

  const viewSliceStore = useViewSliceStore();
  viewStore.getAllViews().forEach((view) => {
    const effective = computeEffectiveView(view, imageID);
    if (effective.kind !== 'volume2D') return;
    if (effective.axis !== toolImageFrame.axis) return;
    viewSliceStore.updateConfig(view.id, imageID, { slice: tool.slice });
  });
}

/**
 * The slice nearest the middle of everything `intervals` cover, snapped into an
 * interval. Content split across distant slices has an empty middle, and a view
 * put there shows nothing of what the user asked to see.
 */
export function snappedCenter(intervals: Array<[number, number]>) {
  if (intervals.length === 0) return undefined;
  const middle =
    (Math.min(...intervals.map(([low]) => low)) +
      Math.max(...intervals.map(([, high]) => high))) /
    2;
  const nearest = intervals
    .map(([low, high]) => Math.min(Math.max(middle, low), high))
    .reduce((best, slice) =>
      Math.abs(slice - middle) < Math.abs(best - middle) ? slice : best
    );
  return Math.round(nearest);
}

/** Where one segment sits on the viewed image, per view axis. */
export type SegmentContent = {
  /** Occupied painted slices for the image's i, j and k index axes. */
  paintedSlicesByIJK?: [number[], number[], number[]];
  /** The slice each shape of the segment was drawn on, by the axis it faces. */
  slicesByAxis: Partial<Record<LPSAxis, number[]>>;
  /** Cine frames containing shapes of this segment. */
  frames?: number[];
};

/**
 * Reveals an occupied frame in the active cine view, or centers every volume
 * 2D view on the segment's content along its axis. Pan and zoom stay where the
 * user left them. A view whose axis holds nothing does not move.
 */
export function revealSegmentContent(imageID: string, content: SegmentContent) {
  const frame = snappedCenter(
    (content.frames ?? []).map((value) => [value, value])
  );
  if (frame != null) revealCineFrame(imageID, frame);

  const { metadata } = useImage(imageID);
  const { lpsOrientation } = metadata.value;
  const viewSliceStore = useViewSliceStore();

  volume2DViewsOfImage(imageID, useViewStore().getAllViews()).forEach(
    ({ viewId, axis }) => {
      const ijk = lpsOrientation[axis];
      const painted = (content.paintedSlicesByIJK?.[ijk] ?? []).map(
        (slice) => [slice, slice] as [number, number]
      );
      const drawn = (content.slicesByAxis[axis] ?? []).map(
        (slice) => [slice, slice] as [number, number]
      );
      const slice = snappedCenter([...painted, ...drawn]);
      if (slice == null) return;
      viewSliceStore.updateConfig(viewId, imageID, { slice });
    }
  );
}
