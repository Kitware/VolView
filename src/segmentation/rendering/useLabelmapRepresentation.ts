import { onScopeDispose, unref, watchEffect, type MaybeRef } from 'vue';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { SlicingMode } from '@kitware/vtk.js/Rendering/Core/ImageMapper/Constants';
import { InterpolationType } from '@kitware/vtk.js/Rendering/Core/ImageProperty/Constants';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import type { View } from '@/src/core/vtk/types';
import type { Maybe } from '@/src/types';
import {
  SEGMENT_ACTOR_OPACITY,
  SEGMENT_COINCIDENT_OFFSET,
} from '@/src/segmentation/rendering/display';

export type LabelmapAppearance = {
  value: number;
  color: readonly number[];
  fillOpacity: number;
  outlineThickness: number;
  outlineOpacity: number;
};

type LabelmapRepresentationOptions = {
  axis: MaybeRef<number | undefined>;
  actorOpacity?: number;
  forceTranslucent?: boolean;
  useLabelOutline?: boolean;
};

/** Renders a borrowed single-plane labelmap with resolved segment appearance. */
export function useLabelmapRepresentation(
  view: View,
  imageData: MaybeRef<Maybe<vtkImageData>>,
  appearance: MaybeRef<LabelmapAppearance | null>,
  options: LabelmapRepresentationOptions
) {
  const sliceRep = useSliceRepresentation(view, imageData);

  // Let widget fill representations be picked through the segment overlay.
  sliceRep.actor.setPickable(false);
  sliceRep.actor.setForceTranslucent(options.forceTranslucent ?? false);

  const colorTransferFunction = vtkColorTransferFunction.newInstance();
  const opacityFunction = vtkPiecewiseFunction.newInstance();
  sliceRep.property.setRGBTransferFunction(0, colorTransferFunction);
  sliceRep.property.setScalarOpacity(0, opacityFunction);
  onScopeDispose(() => {
    colorTransferFunction.delete();
    opacityFunction.delete();
  });
  sliceRep.property.setInterpolationType(InterpolationType.NEAREST);
  sliceRep.property.setOpacity(options.actorOpacity ?? SEGMENT_ACTOR_OPACITY);
  sliceRep.property.setUseLookupTableScalarRange(true);
  sliceRep.property.setUseLabelOutline(options.useLabelOutline ?? true);

  // All labelmaps share an offset from the coplanar base image.
  sliceRep.mapper.setResolveCoincidentTopologyToPolygonOffset();
  sliceRep.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(
    ...SEGMENT_COINCIDENT_OFFSET
  );
  watchEffect(() => {
    const axisIndex = unref(options.axis);
    if (axisIndex === undefined) return;
    sliceRep.mapper.setSlicingMode(
      [SlicingMode.I, SlicingMode.J, SlicingMode.K][axisIndex]
    );
  });
  sliceRep.mapper.setSlice(0);

  watchEffect(() => {
    colorTransferFunction.removeAllPoints();
    opacityFunction.removeAllPoints();

    const segment = unref(appearance);
    if (!segment) return;

    const [r, g, b] = segment.color;
    colorTransferFunction.addRGBPoint(0, 0, 0, 0);
    opacityFunction.addPoint(0, 0);
    colorTransferFunction.addRGBPoint(segment.value, r / 255, g / 255, b / 255);
    opacityFunction.addPoint(segment.value, segment.fillOpacity);
    colorTransferFunction.addRGBPoint(segment.value + 1, 0, 0, 0);
    opacityFunction.addPoint(segment.value + 1, 0);
    sliceRep.property.modified();

    sliceRep.property.setLabelOutlineThickness([segment.outlineThickness]);
    sliceRep.property.setLabelOutlineOpacity([segment.outlineOpacity]);
  });

  onVTKEvent(imageData, 'onModified', () => view.requestRender());

  return sliceRep;
}
