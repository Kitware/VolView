import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkImageReslice from '@kitware/vtk.js/Imaging/Core/ImageReslice';
import { InterpolationMode } from '@kitware/vtk.js/Imaging/Core/AbstractImageInterpolator/Constants';
import { mat4, vec3 } from 'gl-matrix';

/** Reorder an equivalent voxel grid without interpolating label boundaries. */
export function reorientLabelImage(target: vtkImageData, source: vtkImageData) {
  // ImageReslice produces zero-based output extents.
  if (
    [target, source].some((image) =>
      [0, 2, 4].some((axis) => image.getExtent()[axis] !== 0)
    )
  )
    return null;
  const matrix = mat4.multiply(
    mat4.create(),
    source.getWorldToIndex(),
    target.getIndexToWorld()
  );
  const tolerance = 1e-3;
  const axes = [0, 1, 2].map((column) => {
    const values = [0, 1, 2].map((row) => matrix[4 * column + row]);
    const axis = values.findIndex((value) => Math.abs(value) > 0.5);
    if (
      axis < 0 ||
      values.some((value, row) =>
        row === axis
          ? Math.abs(Math.abs(value) - 1) > tolerance
          : Math.abs(value) > tolerance
      )
    )
      return -1;
    return axis;
  });
  if (axes.includes(-1) || new Set(axes).size !== 3) return null;
  const sourceSize = source.getDimensions();
  if (
    target.getDimensions().some((size, axis) => size !== sourceSize[axes[axis]])
  )
    return null;

  // Check the entire extent so rounding error cannot accumulate into a shift
  // at the far edge. Matching physical bounds alone does not imply equal grids.
  const from = target.getExtent();
  const to = source.getExtent();
  for (let corner = 0; corner < 8; corner++) {
    const point = vec3.fromValues(
      from[corner & 1],
      from[2 + ((corner >> 1) & 1)],
      from[4 + ((corner >> 2) & 1)]
    );
    vec3.transformMat4(point, point, matrix);
    if (
      [0, 1, 2].some(
        (axis) =>
          Math.min(
            Math.abs(point[axis] - to[axis * 2]),
            Math.abs(point[axis] - to[axis * 2 + 1])
          ) > tolerance
      )
    )
      return null;
  }

  // The corner check just proved both grids coincide within `tolerance`, so an
  // unpermuted, unflipped mapping means the source already sits on the target
  // grid. Demanding a bit-exact identity here instead would reslice every real
  // image, whose transforms never multiply back to exactly one.
  if (axes.every((axis, column) => axis === column && matrix[5 * column] > 0))
    return source;

  const filter = vtkImageReslice.newInstance();
  filter.setOutputOrigin(target.getOrigin());
  filter.setOutputSpacing(target.getSpacing());
  filter.setOutputDirection(target.getDirection());
  filter.setOutputExtent(target.getExtent());
  filter.setOutputDimensionality(3);
  filter.setTransformInputSampling(false);
  filter.setInterpolationMode(InterpolationMode.NEAREST);
  try {
    filter.setInputData(source);
    return filter.getOutputData() as vtkImageData;
  } finally {
    filter.delete();
  }
}
