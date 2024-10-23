import { describe, it, expect } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageExtractComponentsFilter from '../imageExtractComponentsFilter';

describe('vtkImageExtractComponentsFilter', () => {
  it('should extract specified components', () => {
    // Create an image data with known scalar components
    const imageData = vtkImageData.newInstance();
    imageData.setDimensions([2, 2, 1]);

    // Create scalar data with 3 components per voxel
    const scalars = vtkDataArray.newInstance({
      numberOfComponents: 3,
      values: new Uint8Array([
        // Voxel 0
        10, 20, 30,
        // Voxel 1
        40, 50, 60,
        // Voxel 2
        70, 80, 90,
        // Voxel 3
        100, 110, 120,
      ]),
    });

    imageData.getPointData().setScalars(scalars);

    // Create the filter and set components to extract
    const extractComponentsFilter =
      vtkImageExtractComponentsFilter.newInstance();
    extractComponentsFilter.setComponents([0, 2]); // Extract components 0 and 2
    extractComponentsFilter.setInputData(imageData);
    extractComponentsFilter.update();

    const outputData = extractComponentsFilter.getOutputData();
    const outputScalars = outputData.getPointData().getScalars();
    const outputValues = outputScalars.getData();

    // Expected output
    const expectedValues = new Uint8Array([
      // Voxel 0
      10, 30,
      // Voxel 1
      40, 60,
      // Voxel 2
      70, 90,
      // Voxel 3
      100, 120,
    ]);

    // Check if output matches expected values
    expect(outputScalars.getNumberOfComponents()).toBe(2);
    expect(outputValues).toEqual(expectedValues);
  });
});
