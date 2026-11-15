import { datasetFromTags } from '@/tests/dicomDataset';
import { describe, it, expect } from 'vitest';
import {
  readGeometryFacts,
  sliceNormalOf,
} from '../../collections/instanceFacts';
import { reconstructVolume } from '../../collections/reconstructVolume';
import { Tags } from '../../metadata/dicomTags';
import { volumeLayout, type VolumeSource } from '../volumeLayout';

function volumeSource(overrides: Record<string, string> = {}) {
  const metadata = {
    [Tags.SOPInstanceUID]: '1.2.3',
    [Tags.ImagePositionPatient]: '0\\0\\0',
    [Tags.ImageOrientationPatient]: '1\\0\\0\\0\\1\\0',
    [Tags.Rows]: '3',
    [Tags.Columns]: '4',
    [Tags.BitsStored]: '16',
    [Tags.PixelRepresentation]: '0',
    [Tags.SamplesPerPixel]: '1',
    ...overrides,
  };
  return { dataset: datasetFromTags(Object.entries(metadata)) };
}

function positionedSource(z: number, overrides: Record<string, string> = {}) {
  return volumeSource({
    [Tags.ImagePositionPatient]: `0\\0\\${z}`,
    ...overrides,
  });
}

const AXIAL = [1, 0, 0, 0, 1, 0];

/** Plans the members' stack as the collection planner would, then lays it out. */
function layoutOf(sources: VolumeSource[], orientation: number[] | null) {
  const reconstruction = reconstructVolume(
    sources.map((item) => readGeometryFacts(item.dataset)),
    sliceNormalOf(orientation)
  );
  return volumeLayout(sources, orientation, reconstruction);
}

const spacingOf = (layout: ReturnType<typeof layoutOf>) =>
  layout.spatialMetadata.axes.map((axis) => axis.value);

const dimensionsOf = ({
  columns,
  rows,
  slices,
}: ReturnType<typeof layoutOf>) => [columns, rows, slices];

describe('volumeLayout', () => {
  it.each([
    ['0.0104\\0', [1, 0.0104, 1]],
    ['0.0104\\NaN', [1, 0.0104, 1]],
    ['0\\0.046875', [0.046875, 1, 1]],
    ['NaN\\0.046875', [0.046875, 1, 1]],
    ['0\\0', [1, 1, 1]],
  ])(
    'preserves valid axes independently for PixelSpacing %s',
    (value, expected) => {
      const layout = layoutOf(
        [volumeSource({ [Tags.PixelSpacing]: value })],
        AXIAL
      );
      expect(spacingOf(layout)).toEqual(expected);
    }
  );

  it('allocates for the modality range of every member', () => {
    const layout = layoutOf(
      [
        positionedSource(0),
        positionedSource(1, {
          [Tags.BitsStored]: '16',
          [Tags.PixelRepresentation]: '0',
          [Tags.RescaleSlope]: '112067.85375182',
          [Tags.RescaleIntercept]: '0',
        }),
      ],
      AXIAL
    );
    expect(layout.bufferType).toBe(Float32Array);
    expect(dimensionsOf(layout)).toEqual([4, 3, 2]);
  });

  it('matches ITK spacing order for single-slice images with SpacingBetweenSlices', () => {
    const layout = layoutOf(
      [
        volumeSource({
          [Tags.PixelSpacing]: '2.5\\0.75',
          [Tags.SpacingBetweenSlices]: '7.25',
        }),
      ],
      AXIAL
    );

    expect(spacingOf(layout)).toEqual([0.75, 2.5, 7.25]);
  });

  it('uses declared inter-frame spacing for a multi-frame volume', () => {
    const layout = layoutOf(
      [
        volumeSource({
          [Tags.NumberOfFrames]: '32',
          [Tags.PixelSpacing]: '0.0104\\0.046875',
          [Tags.SpacingBetweenSlices]: '0.1875',
        }),
      ],
      AXIAL
    );
    expect(dimensionsOf(layout)).toEqual([4, 3, 32]);
    expect(spacingOf(layout)).toEqual([0.046875, 0.0104, 0.1875]);
  });

  it('takes the multi-slice Z spacing from positions over a declared SpacingBetweenSlices', () => {
    const layout = layoutOf(
      [
        positionedSource(0, {
          [Tags.PixelSpacing]: '2.5\\0.75',
          [Tags.SpacingBetweenSlices]: '19',
        }),
        positionedSource(9),
        positionedSource(18),
      ],
      AXIAL
    );

    expect(spacingOf(layout)).toEqual([0.75, 2.5, 9]);
  });

  it('orients the image along the validated slice normal', () => {
    const layout = layoutOf(
      [volumeSource({ [Tags.ImageOrientationPatient]: '0\\1\\0\\0\\0\\-1' })],
      [0, 1, 0, 0, 0, -1]
    );

    expect(layout.direction).toEqual([0, 1, 0, 0, 0, -1, -1, 0, 0]);
  });

  it('gives no direction for an orientation that spans no plane', () => {
    const layout = layoutOf(
      [volumeSource({ [Tags.ImageOrientationPatient]: '1\\0\\0\\1\\0\\0' })],
      null
    );

    expect(layout.direction).toBeNull();
  });

  it('leaves the Z spacing alone when no position can be read', () => {
    const layout = layoutOf(
      [
        volumeSource({ [Tags.ImagePositionPatient]: '' }),
        volumeSource({ [Tags.ImagePositionPatient]: '' }),
      ],
      AXIAL
    );

    expect(spacingOf(layout)[2]).toBe(1);
  });

  it('takes the declared SpacingBetweenSlices when no position can be read', () => {
    const layout = layoutOf(
      [
        volumeSource({
          [Tags.ImagePositionPatient]: '',
          [Tags.SpacingBetweenSlices]: '2.5',
        }),
        volumeSource({ [Tags.ImagePositionPatient]: '' }),
      ],
      AXIAL
    );

    expect(spacingOf(layout)[2]).toBe(2.5);
  });
});
