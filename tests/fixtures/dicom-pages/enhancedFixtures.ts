import {
  buildSyntheticDicom,
  rawElement,
  sequenceItem,
} from '../../specs/syntheticDicom';

const concatenate = (parts: Uint8Array[]) => {
  const bytes = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0)
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};

const text = (group: number, element: number, value: readonly number[]) => {
  const string = value.join('\\');
  return rawElement(
    group,
    element,
    'DS',
    new TextEncoder().encode(string.length % 2 ? `${string} ` : string)
  );
};

const sequence = (group: number, element: number, items: Uint8Array[]) =>
  rawElement(group, element, 'SQ', concatenate(items.map(sequenceItem)));

const position = (value: readonly number[]) =>
  sequence(0x0020, 0x9113, [text(0x0020, 0x0032, value)]);

const transformation = ([slope, intercept]: readonly [number, number]) =>
  sequence(0x0028, 0x9145, [
    concatenate([
      text(0x0028, 0x1052, [intercept]),
      text(0x0028, 0x1053, [slope]),
    ]),
  ]);

const temporalPosition = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return sequence(0x0020, 0x9111, [rawElement(0x0020, 0x9128, 'UL', bytes)]);
};

export type EnhancedFixtureOptions = {
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
    sequence(0x0020, 0x9116, [text(0x0020, 0x0037, [1, 0, 0, 0, 1, 0])]),
    sequence(0x0028, 0x9110, [text(0x0028, 0x0030, [1, 1])]),
  ];
  if (sharedPosition) shared.unshift(position(sharedPosition));
  const frames = pixelValues.map((_, index) =>
    concatenate([
      ...(temporalPositions
        ? [temporalPosition(temporalPositions[index])]
        : []),
      ...(sharedPosition
        ? []
        : [position(positions?.[index] ?? [10, 20, 30 + index])]),
      ...(transforms ? [transformation(transforms[index])] : []),
    ])
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
      sequence(0x5200, 0x9229, [concatenate(shared)]),
      sequence(0x5200, 0x9230, frames),
    ],
  });
}
