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
  EffectiveView,
} from '@/src/core/views/effectiveView';

export type Locator =
  | { kind: 'none' }
  | {
      kind: 'spatial';
      slice: number;
      axis: LPSAxis;
      frameOfReference: FrameOfReference;
    }
  | { kind: 'temporal'; frame: number }
  | {
      kind: 'spatiotemporal';
      slice: number;
      axis: LPSAxis;
      frameOfReference: FrameOfReference;
      frame: number;
    };

export type LocatorFields = Pick<
  AnnotationTool,
  'slice' | 'frameOfReference' | 'frame'
>;

export interface ViewCursors {
  slice?: number;
  axis?: LPSAxis;
  frameOfReference?: FrameOfReference;
  frame?: number;
}

export function viewLocator(
  effective: EffectiveView | null,
  cursors: ViewCursors
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

// Axis match is enforced separately by `doesToolFrameMatchViewAxis` (it needs
// per-image metadata, which the locator deliberately does not).
export function locatorMatches(tool: AnnotationTool, here: Locator) {
  switch (here.kind) {
    case 'none':
      return false;
    case 'temporal':
      return tool.frame === here.frame;
    case 'spatial':
      return tool.slice === here.slice && !!tool.frameOfReference;
    case 'spatiotemporal':
      return tool.frame === here.frame && tool.slice === here.slice;
    default:
      return false;
  }
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
    case 'spatiotemporal':
      return {
        slice: here.slice,
        frameOfReference: here.frameOfReference,
        frame: here.frame,
      };
    case 'none':
    default:
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

export function applyLocator(imageID: string, tool: AnnotationTool) {
  const viewStore = useViewStore();

  if (tool.frame != null) {
    const activeView = viewStore.activeView;
    if (!activeView) return;
    useCinePlaybackStore().updateConfig(activeView, imageID, {
      frame: tool.frame,
    });
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
