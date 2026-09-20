import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { InterfaceTypes, runPipelineNode, type Image } from 'itk-wasm';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
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

function makeImage(
  dimensions: [number, number, number] = [2, 3, 1],
  values = new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2])
) {
  const image = vtkImageData.newInstance();
  image.setDimensions(dimensions);
  image
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));
  return image;
}

describe('labelmap import index alignment', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['at index zero', [0, 1, 0, 2, 0, 0]],
    ['past index zero', [1, 2, 1, 3, 0, 0]],
  ] as const)(
    'reuses the scalar buffer when the index grids already match %s',
    async (_start, extent) => {
      const runWasm = useNodeResampling();
      const [parent, child] = [makeImage(), makeImage()];
      [parent, child].forEach((image) => image.setExtent([...extent]));
      const result = await ensureSameSpace(parent, child, true);
      // The contract is no resampling and no voxel copy. The wrapper is the
      // caller's to own, so it is not the candidate itself.
      expect(result.getPointData().getScalars().getData()).toBe(
        child.getPointData().getScalars().getData()
      );
      expect(runWasm).not.toHaveBeenCalled();
    }
  );

  it('reorients a reflected label child onto the parent grid without resampling', async () => {
    const runWasm = useNodeResampling();
    const parent = makeImage();
    const child = makeImage();
    child.setOrigin([0, 2, 0]);
    child.setDirection(1, 0, 0, 0, -1, 0, 0, 0, 1);
    child.getPointData().getScalars().setComponent(0, 0, 7);
    const imported = await ensureSameSpace(parent, child, true);

    expect(runWasm).not.toHaveBeenCalled();
    expect(imported.getDirection()).toEqual(parent.getDirection());
    expect(imported.getOrigin()).toEqual(parent.getOrigin());
    expect(Array.from(imported.getPointData().getScalars().getData())).toEqual([
      0, 0, 0, 0, 7, 0,
    ]);
  });

  it('resamples a label child on another sampling without inventing labels', async () => {
    useNodeResampling();
    const parent = makeImage([3, 3, 1]);
    // Twice the parent's spacing in i, so parent i = 1 falls between 1 and 3.
    const child = makeImage([2, 3, 1], new Uint8Array([1, 3, 0, 0, 1, 3]));
    child.setSpacing([2, 1, 1]);

    const imported = await ensureSameSpace(parent, child, true);

    expect(new Set(imported.getPointData().getScalars().getData())).toEqual(
      new Set([0, 1, 3])
    );
  });
});
