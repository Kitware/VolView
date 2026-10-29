import { describe, expect, it, onTestFinished } from 'vitest';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkPiecewiseGaussianWidget from '@kitware/vtk.js/Interaction/Widgets/PiecewiseGaussianWidget';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import {
  ADAPTIVE_VOLUME_PRESETS,
  getAdaptiveVolumePreset,
} from '../adaptiveVolumePreset';

function makeImage(values: Float32Array, size: number) {
  const image = vtkImageData.newInstance();
  const scalars = vtkDataArray.newInstance({ values, numberOfComponents: 1 });
  image.setDimensions(size, size, size);
  image.getPointData().setScalars(scalars);
  onTestFinished(() => {
    image.delete();
    scalars.delete();
  });
  return image;
}

function makeSparseImage(size: number, background: number, start: number) {
  const values = new Float32Array(size ** 3).fill(background);
  const width = size === 256 ? 5 : 3;
  for (let z = start; z < start + width; z += 1) {
    for (let y = start; y < start + width; y += 1) {
      for (let x = start; x < start + width; x += 1) {
        values[x + size * (y + size * z)] = background + 1000;
      }
    }
  }
  return makeImage(values, size);
}

function transferFunctions(image: vtkImageData, preset: string) {
  const config = getAdaptiveVolumePreset(image, preset);
  if (
    !config ||
    config.opacityFunction.mode !== vtkPiecewiseFunctionProxy.Mode.Gaussians
  ) {
    throw new Error('Expected an adaptive Gaussian opacity function');
  }
  const opacity = vtkPiecewiseFunction.newInstance();
  vtkPiecewiseGaussianWidget.applyGaussianToPiecewiseFunction(
    config.opacityFunction.gaussians,
    256,
    config.opacityFunction.mappingRange,
    opacity
  );
  const color = vtkColorTransferFunction.newInstance();
  color.applyColorMap(vtkColorMaps.getPresetByName('Grayscale'));
  color.setMappingRange(...config.transferFunction.mappingRange);
  onTestFinished(() => {
    opacity.delete();
    color.delete();
  });
  return {
    opacity: (value: number) => opacity.getValue(value),
    brightness: (value: number) => {
      const rgb: number[] = [];
      color.getColor(value, rgb);
      return rgb[0];
    },
  };
}

describe('adaptive volume transfer functions', () => {
  it.each([120, 121])(
    'keeps sparse foreground visible at voxel offset %i',
    (start) => {
      const image = makeSparseImage(256, 0, start);
      ADAPTIVE_VOLUME_PRESETS.forEach((preset) => {
        const transfer = transferFunctions(image, preset);
        expect(transfer.opacity(0)).toBe(0);
        expect(transfer.opacity(1000)).toBeGreaterThan(0);
        expect(transfer.brightness(0)).toBe(0);
        expect(transfer.brightness(1000)).toBe(1);
      });
    }
  );

  it.each([0, 100, -1000])(
    'separates a rare signal from background %i',
    (background) => {
      const image = makeSparseImage(32, background, 15);
      ADAPTIVE_VOLUME_PRESETS.forEach((preset) => {
        const transfer = transferFunctions(image, preset);
        expect(transfer.opacity(background)).toBe(0);
        expect(transfer.opacity(background + 1000)).toBeGreaterThan(0);
        expect(transfer.brightness(background)).toBe(0);
        expect(transfer.brightness(background + 1000)).toBe(1);
      });
    }
  );

  it.each([0, 100, -1000])(
    'keeps the constant value %i transparent only when it is zero',
    (value) => {
      const image = makeImage(new Float32Array(32 ** 3).fill(value), 32);
      ADAPTIVE_VOLUME_PRESETS.forEach((preset) => {
        const transfer = transferFunctions(image, preset);
        if (value === 0) expect(transfer.opacity(value)).toBe(0);
        else expect(transfer.opacity(value)).toBeGreaterThan(0);
      });
    }
  );

  it('trims a high outlier within a rare upper tail', () => {
    const image = makeSparseImage(32, 100, 15);
    const scalars = image.getPointData().getScalars();
    scalars.getData()[0] = 1e6;
    scalars.modified();
    ADAPTIVE_VOLUME_PRESETS.forEach((preset) => {
      const transfer = transferFunctions(image, preset);
      expect(transfer.opacity(100)).toBe(0);
      expect(transfer.opacity(1100)).toBeGreaterThan(0);
      expect(transfer.brightness(1100)).toBe(1);
    });
  });

  it('keeps ordinary multilevel contrast despite a high outlier', () => {
    const values = Float32Array.from(
      { length: 32 ** 3 },
      (_, index) => index % 1000
    );
    values[0] = 1e6;
    const image = makeImage(values, 32);
    ADAPTIVE_VOLUME_PRESETS.forEach((preset) => {
      const transfer = transferFunctions(image, preset);
      expect(transfer.opacity(0)).toBe(0);
      expect(transfer.opacity(999)).toBeGreaterThan(0);
      expect(transfer.brightness(750)).toBeGreaterThan(0.1);
      expect(transfer.brightness(999)).toBe(1);
    });
  });

  it('refits changed scalars after an initially transparent image', () => {
    const image = makeImage(new Float32Array(32 ** 3), 32);
    ADAPTIVE_VOLUME_PRESETS.forEach((preset) => {
      expect(transferFunctions(image, preset).opacity(1000)).toBe(0);
    });
    const scalars = image.getPointData().getScalars();
    scalars.getData()[0] = 1000;
    scalars.modified();
    ADAPTIVE_VOLUME_PRESETS.forEach((preset) => {
      const transfer = transferFunctions(image, preset);
      expect(transfer.opacity(0)).toBe(0);
      expect(transfer.opacity(1000)).toBeGreaterThan(0);
    });
  });
});
