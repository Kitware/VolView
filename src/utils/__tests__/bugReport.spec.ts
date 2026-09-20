import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageStore } from '@/src/store/datasets-images';
import { generateBugReport } from '@/src/utils/bugReport';

const seatImage = (id = 'img-1') => {
  const data = vtkImageData.newInstance();
  data.setDimensions(2, 2, 2);
  data.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: 'scalars',
      numberOfComponents: 1,
      values: new Uint8Array(8),
    })
  );
  useImageStore().addVTKImageData('CT', data, { id });
};

describe('generateBugReport', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('describes a healthy dataset', async () => {
    seatImage();
    // Image metadata is a Vue watcher, so it lands on the next flush.
    await nextTick();

    const report = generateBugReport(new Error('boom'));

    expect(report).toContain('Datasets: 1');
    expect(report).toContain('2×2×2 Uint8');
    expect(report).toContain('boom');
  });

  it('counts every dataset it describes', async () => {
    seatImage('img-1');
    seatImage('img-2');
    await nextTick();

    const report = generateBugReport(new Error('boom'));

    expect(report).toContain('Datasets: 2');
    expect(report).toContain('[0]');
    expect(report).toContain('[1]');
  });
});
