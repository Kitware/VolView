import {
  buildSyntheticDicom,
  combine,
  ds,
  sequence,
  ul,
} from '../../specs/syntheticDicom';

const decimals = (group: number, element: number, values: readonly number[]) =>
  ds(group, element, values.join('\\'));

const position = (value: readonly number[]) =>
  sequence(0x0020, 0x9113, [decimals(0x0020, 0x0032, value)]);

const transformation = ([slope, intercept]: readonly [number, number]) =>
  sequence(0x0028, 0x9145, [
    combine(
      ds(0x0028, 0x1052, String(intercept)),
      ds(0x0028, 0x1053, String(slope))
    ),
  ]);

const temporalPosition = (value: number) =>
  sequence(0x0020, 0x9111, [ul(0x0020, 0x9128, value)]);

type EnhancedFixtureOptions = {
  pixelValues: number[];
  positions?: number[][];
  sharedPosition?: number[];
  temporalPositions?: number[];
  transforms?: Array<readonly [number, number]>;
};

/** Encoded spatial/temporal frames with geometry exclusively in Functional Groups. */
export function enhancedFixtureBytes(options: EnhancedFixtureOptions) {
  const {
    pixelValues,
    positions,
    sharedPosition,
    temporalPositions,
    transforms,
  } = options;
  const shared = [
    sequence(0x0020, 0x9116, [decimals(0x0020, 0x0037, [1, 0, 0, 0, 1, 0])]),
    sequence(0x0028, 0x9110, [decimals(0x0028, 0x0030, [1, 1])]),
  ];
  if (sharedPosition) shared.unshift(position(sharedPosition));
  const frames = pixelValues.map((_, index) =>
    combine(
      ...(temporalPositions
        ? [temporalPosition(temporalPositions[index])]
        : []),
      ...(sharedPosition
        ? []
        : [position(positions?.[index] ?? [10, 20, 30 + index])]),
      ...(transforms ? [transformation(transforms[index])] : [])
    )
  );
  return buildSyntheticDicom({
    studyUid: '1.2.826.0.1.3680043.10.999.50',
    seriesUid: '1.2.826.0.1.3680043.10.999.51',
    sopUid: '1.2.826.0.1.3680043.10.999.52',
    sopClassUid: transforms
      ? '1.2.840.10008.5.1.4.1.1.2.1'
      : '1.2.840.10008.5.1.4.1.1.4.1',
    modality: transforms ? 'CT' : 'MR',
    instanceNumber: 1,
    imagePositionPatient: null,
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    rootGeometry: false,
    framePixelValues: pixelValues,
    extraElements: [
      sequence(0x5200, 0x9229, [combine(...shared)]),
      sequence(0x5200, 0x9230, frames),
    ],
  });
}
