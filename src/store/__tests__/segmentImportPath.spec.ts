import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { resolve } from 'node:path';
import { InterfaceTypes, runPipelineNode, type Image } from 'itk-wasm';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useImageCacheStore } from '@/src/store/image-cache';
import { ensureSameSpace } from '@/src/io/resample/resample';
import * as wasm from '@/src/io/resample/itkWasmUtils';

// Browser workers are unavailable in the test environment.
function useNodeResampling() {
  return vi
    .spyOn(wasm, 'runWasm')
    .mockImplementation(async (pipeline, args, images) => {
      const result = await runPipelineNode(
        resolve('src/io/resample/emscripten-build', pipeline),
        ['0', '0', ...args, '--memory-io'],
        [{ type: InterfaceTypes.Image }],
        images.map((data: Image) => ({ type: InterfaceTypes.Image, data }))
      );
      expect(result.returnValue).toBe(0);
      return result.outputs[0].data as Image;
    });
}

function makeImage() {
  const image = vtkImageData.newInstance();
  image.setDimensions(2, 3, 1);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(6),
    })
  );
  return image;
}

describe('labelmap import index alignment', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reuses the scalar buffer when the index grids already match', async () => {
    const runWasm = useNodeResampling();
    const parent = makeImage();
    const child = makeImage();
    const result = await ensureSameSpace(parent, child, true);
    // The contract is no resampling and no voxel copy. The wrapper is the
    // caller's to own, so it is not the candidate itself.
    expect(result.getPointData().getScalars().getData()).toBe(
      child.getPointData().getScalars().getData()
    );
    expect(runWasm).not.toHaveBeenCalled();
  });

  it('resamples a reflected child onto the parent grid with label interpolation', async () => {
    setActivePinia(createPinia());
    const runWasm = useNodeResampling();
    const parent = makeImage();
    const child = makeImage();
    child.setOrigin([0, 2, 0]);
    child.setDirection(1, 0, 0, 0, -1, 0, 0, 0, 1);
    child.getPointData().getScalars().setComponent(0, 0, 7);
    const cache = useImageCacheStore();
    cache.addVTKImageData(parent, 'CTA', { id: 'parent' });
    cache.addVTKImageData(child, 'cta-head-neck-total.seg.nii.gz', {
      id: 'child',
    });

    const store = useSegmentGroupStore();
    const [id] = await store.convertImageToLabelmap('child', 'parent');
    const imported = store.dataIndex[id];

    expect(runWasm).toHaveBeenCalledOnce();
    expect(runWasm.mock.calls[0][1]).toContain('--label');
    expect(imported.getDirection()).toEqual(parent.getDirection());
    expect(imported.getOrigin()).toEqual(parent.getOrigin());
    expect(Array.from(imported.getPointData().getScalars().getData())).toEqual([
      0, 0, 0, 0, 7, 0,
    ]);
  });
});
