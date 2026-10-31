import type vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

export function getAllComponentRange(scalars: vtkDataArray): [number, number] {
  const ranges = Array.from(
    { length: scalars.getNumberOfComponents() },
    (_, component) => scalars.getRange(component)
  );
  return [
    Math.min(...ranges.map(([minimum]) => minimum)),
    Math.max(...ranges.map(([, maximum]) => maximum)),
  ];
}
