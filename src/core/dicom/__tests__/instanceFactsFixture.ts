import type { InstanceFacts } from '@/src/core/dicom/planDicomCollections';

export const IDENTITY_ORIENTATION = [1, 0, 0, 0, 1, 0];

// Rotates the second orientation row by theta, leaving both rows unit length.
export const tiltedOrientation = (theta: number) => [
  1,
  0,
  0,
  0,
  Math.cos(theta),
  Math.sin(theta),
];

export const orientationKeyValue = (orientation: number[]) =>
  orientation.map(String).join(',');

// The position and its projection are one fact, so a fixture naming only the
// projection gets the axial position that produces it.
const positionFor = (overrides: Partial<InstanceFacts>) => {
  if ('position' in overrides) return overrides.position ?? null;
  const projected =
    'projectedPosition' in overrides ? overrides.projectedPosition : 0;
  return projected === null || projected === undefined
    ? null
    : [0, 0, projected];
};

const defaults = (sopInstanceUid: string | null): InstanceFacts => ({
  sopInstanceUid,
  seriesInstanceUid: 'series-1',
  seriesNumber: '1',
  sequenceName: null,
  sliceThickness: '1',
  seriesDate: '20240101',
  rows: '4',
  columns: '4',
  samplesPerPixel: '1',
  numberOfFrames: null,
  orientation: IDENTITY_ORIENTATION,
  position: [0, 0, 0],
  projectedPosition: 0,
  pixelSpacing: [1, 1],
  instanceNumber: 1,
  acquisitionNumber: null,
  temporalPositionIdentifier: null,
  echoNumbers: null,
  diffusionBValue: null,
});

export const makeFacts = (
  sopInstanceUid: string | null,
  overrides: Partial<InstanceFacts> = {}
): InstanceFacts => ({
  ...defaults(sopInstanceUid),
  ...overrides,
  position: positionFor(overrides),
});

export const clone = (value: unknown) => JSON.parse(JSON.stringify(value));
