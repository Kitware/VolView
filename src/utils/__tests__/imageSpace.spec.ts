import { describe, expect, it } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import {
  compareImageIndexGrids,
  compareImageSpaces,
  repairUnusableSpacing,
} from '../imageSpace';

describe('compareImageIndexGrids', () => {
  it('distinguishes a reflected index grid from equivalent physical coverage', () => {
    const parent = vtkImageData.newInstance();
    parent.setDimensions(2, 3, 1);
    const child = vtkImageData.newInstance();
    child.setDimensions(2, 3, 1);
    child.setOrigin([0, 2, 0]);
    child.setDirection(1, 0, 0, 0, -1, 0, 0, 0, 1);

    expect(compareImageSpaces(parent, child)).toBe(true);
    expect(compareImageIndexGrids(parent, child)).toBe(false);
  });

  it('accepts identical grids and tolerates small transform roundoff', () => {
    const a = vtkImageData.newInstance();
    const b = vtkImageData.newInstance();
    a.setDimensions(2, 3, 1);
    b.setDimensions(2, 3, 1);
    expect(compareImageIndexGrids(a, b)).toBe(true);
    b.setOrigin([0.00001, 0, 0]);
    expect(compareImageIndexGrids(a, b)).toBe(true);
    b.setOrigin([0.01, 0, 0]);
    expect(compareImageIndexGrids(a, b)).toBe(false);
  });

  it('rejects different extents even with the same transform', () => {
    const a = vtkImageData.newInstance();
    const b = vtkImageData.newInstance();
    a.setExtent(0, 1, 0, 2, 0, 0);
    b.setExtent(1, 2, 0, 2, 0, 0);
    expect(compareImageIndexGrids(a, b)).toBe(false);
  });

  it('rejects different sampling densities over the same physical box', () => {
    const a = vtkImageData.newInstance();
    const b = vtkImageData.newInstance();
    a.setDimensions(3, 3, 3);
    b.setDimensions(5, 5, 5);
    b.setSpacing([0.5, 0.5, 0.5]);
    expect(compareImageSpaces(a, b)).toBe(true);
    expect(compareImageIndexGrids(a, b)).toBe(false);
  });

  it('rejects small spacing errors that accumulate across a large grid', () => {
    const a = vtkImageData.newInstance();
    const b = vtkImageData.newInstance();
    a.setDimensions(512, 512, 1);
    b.setDimensions(512, 512, 1);
    a.setSpacing([0.541, 0.541, 1]);
    b.setSpacing([0.5419, 0.541, 1]);

    expect(compareImageIndexGrids(a, b)).toBe(false);
  });

  it('rejects an axis rotation with the same physical coverage', () => {
    const a = vtkImageData.newInstance();
    const b = vtkImageData.newInstance();
    a.setDimensions(3, 3, 3);
    b.setDimensions(3, 3, 3);
    b.setOrigin([2, 0, 0]);
    b.setDirection(0, 1, 0, -1, 0, 0, 0, 0, 1);
    expect(compareImageSpaces(a, b)).toBe(true);
    expect(compareImageIndexGrids(a, b)).toBe(false);
  });
});

describe('repairUnusableSpacing', () => {
  it('replaces zero and non-finite spacing and keeps negative spacing', () => {
    const image = vtkImageData.newInstance();
    image.setSpacing([0, -0.5, NaN]);

    expect(repairUnusableSpacing(image)).toEqual([0, -0.5, NaN]);
    expect(image.getSpacing()).toEqual([1, -0.5, 1]);
  });

  it('leaves usable spacing unchanged', () => {
    const image = vtkImageData.newInstance();
    image.setSpacing([0.7, 0.7, 2.5]);

    expect(repairUnusableSpacing(image)).toBeNull();
    expect(image.getSpacing()).toEqual([0.7, 0.7, 2.5]);
  });
});
