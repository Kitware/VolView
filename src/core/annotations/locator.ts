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
import { useEnFaceViewStore } from '@/src/enface/store';
import { centerSlabOnSlice } from '@/src/core/slab/range';
import { LPSAxes } from '@/src/utils/lps';
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
  if (effective.kind === 'volume2D' || effective.kind === 'enface') {
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

function revealEnFaceSlices(
  imageID: string,
  sliceForAxis: (axis: LPSAxis) => number | undefined
) {
  const { metadata } = useImage(imageID);
  const { dimensions, lpsOrientation } = metadata.value;
  const enFaceStore = useEnFaceViewStore();
  useViewStore()
    .getAllViews()
    .forEach((view) => {
      const effective = getEffectiveView(view.id);
      if (effective?.kind !== 'enface' || effective.renderDataID !== imageID)
        return;
      const settings = enFaceStore.configFor(view.id, imageID);
      const axis = LPSAxes.find(
        (name) => lpsOrientation[name] === settings.axis
      );
      if (!axis) return;
      const slice = sliceForAxis(axis);
      if (slice == null) return;
      const { first, last } = centerSlabOnSlice(
        {
          first: settings.depthStart,
          last: settings.depthEnd,
          maximum: dimensions[settings.axis] - 1,
        },
        slice
      );
      Object.assign(settings, { depthStart: first, depthEnd: last });
    });
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
  revealEnFaceSlices(imageID, (axis) =>
    axis === toolImageFrame.axis ? tool.slice : undefined
  );
}

/**
 * The listed slice nearest the middle of them all. Content split across
 * distant slices has an empty middle, and a view put there shows nothing of
 * what the user asked to see.
 */
export function snappedCenter(slices: number[]) {
  if (slices.length === 0) return undefined;
  const middle = (Math.min(...slices) + Math.max(...slices)) / 2;
  return slices.reduce((best, slice) => {
    // Equally distant slices settle on the lower one, whatever the order.
    const closer = Math.abs(slice - middle) - Math.abs(best - middle);
    return closer < 0 || (closer === 0 && slice < best) ? slice : best;
  });
}

export type SegmentContent = {
  paintedSlicesByIJK?: [number[], number[], number[]];
  /** The slice each shape of the segment was drawn on, by the axis it faces. */
  slicesByAxis: Partial<Record<LPSAxis, number[]>>;
  /** Cine frames containing shapes of this segment. */
  frames: number[];
};

/**
 * Reveals an occupied cine frame or centers bound slice and En face views on
 * the segment's content along their axis. A view whose axis holds nothing does
 * not move. Pan and zoom stay where the user left them.
 */
export function revealSegmentContent(imageID: string, content: SegmentContent) {
  const frame = snappedCenter(content.frames);
  if (frame != null) revealCineFrame(imageID, frame);

  const { metadata } = useImage(imageID);
  const { lpsOrientation } = metadata.value;
  const viewSliceStore = useViewSliceStore();
  const sliceForAxis = (axis: LPSAxis) =>
    snappedCenter([
      ...(content.paintedSlicesByIJK?.[lpsOrientation[axis]] ?? []),
      ...(content.slicesByAxis[axis] ?? []),
    ]);

  volume2DViewsOfImage(imageID, useViewStore().getAllViews()).forEach(
    ({ viewId, axis }) => {
      const slice = sliceForAxis(axis);
      if (slice == null) return;
      viewSliceStore.updateConfig(viewId, imageID, { slice });
    }
  );
  revealEnFaceSlices(imageID, sliceForAxis);
}
