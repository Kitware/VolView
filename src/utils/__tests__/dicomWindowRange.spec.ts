import { describe, expect, it } from 'vitest';
import { Tags } from '@/src/core/dicomTags';
import { getConsistentDicomWindowRange } from '@/src/utils/dicomWindowRange';

function windowTags(center: string, width: string, voiFunction?: string) {
  return Object.entries({
    [Tags.WindowLevel]: center,
    [Tags.WindowWidth]: width,
    ...(voiFunction === undefined
      ? {}
      : { [Tags.VOILUTFunction]: voiFunction }),
  });
}

describe('DICOM window display range', () => {
  it.each([
    ['unsigned identity', '2048', '4096', undefined, [0, 4095]],
    ['signed window', '0', '100', 'LINEAR', [-50, 49]],
    ['fractional exact window', '0.5', '1', 'LINEAR_EXACT', [0, 1]],
    ['sub-unit exact width', '0', '0.25', 'LINEAR_EXACT', [-0.125, 0.125]],
  ] as const)(
    'uses the standard boundaries for %s',
    (_name, center, width, voiFunction, expected) => {
      expect(
        getConsistentDicomWindowRange([windowTags(center, width, voiFunction)])
      ).toEqual(expected);
    }
  );

  it('compares parsed values across chunks and defaults an absent function to LINEAR', () => {
    expect(
      getConsistentDicomWindowRange([
        windowTags('1000', '2000'),
        windowTags(' +1e3 ', '2.000E+3', ' LINEAR '),
        windowTags('1000.0', '2000.', ''),
      ])
    ).toEqual([0, 1999]);
  });

  it('chooses the first paired alternative without mixing centers and widths', () => {
    expect(
      getConsistentDicomWindowRange([
        windowTags('50\\500', '100\\1000'),
        windowTags('50.0\\750', '1e2\\1500'),
      ])
    ).toEqual([0, 99]);
  });

  it.each([
    ['no chunks', []],
    ['missing first metadata', [undefined, windowTags('50', '100')]],
    ['missing later metadata', [windowTags('50', '100'), null]],
    ['missing center', [[[Tags.WindowWidth, '100']]]],
    ['missing width', [[[Tags.WindowLevel, '50']]]],
    ['different centers', [windowTags('50', '100'), windowTags('51', '100')]],
    ['different widths', [windowTags('50', '100'), windowTags('50', '101')]],
    [
      'different functions',
      [windowTags('50', '100'), windowTags('50', '100', 'LINEAR_EXACT')],
    ],
  ] as const)('rejects %s', (_name, metadata) => {
    expect(getConsistentDicomWindowRange(metadata)).toBeUndefined();
  });

  it.each([
    ['empty center', '', '100', undefined],
    ['blank center', '   ', '100', undefined],
    ['empty width', '50', '', undefined],
    ['blank width', '50', '   ', undefined],
    ['incomplete exponent', '1e-', '100', undefined],
    ['trailing center text', '50abc', '100', undefined],
    ['trailing width text', '50', '100abc', undefined],
    ['hexadecimal center', '0x10', '100', undefined],
    ['infinite center', 'Infinity', '100', undefined],
    ['infinite width', '50', 'Infinity', undefined],
    ['nonfinite decimal', '1e999', '100', undefined],
    ['NaN center', 'NaN', '100', undefined],
    ['zero width', '50', '0', undefined],
    ['negative width', '50', '-100', undefined],
    ['LINEAR threshold', '50', '1', undefined],
    ['sub-unit LINEAR width', '50', '0.5', 'LINEAR'],
    ['zero exact width', '50', '0', 'LINEAR_EXACT'],
    ['SIGMOID function', '50', '100', 'SIGMOID'],
    ['unknown function', '50', '100', 'CUSTOM'],
    ['mismatched alternatives', '50\\500', '100', undefined],
    ['blank alternative', '50\\', '100\\1000', undefined],
    ['malformed alternative', '50\\bad', '100\\1000', undefined],
    ['nonpositive alternative', '50\\500', '100\\0', undefined],
    ['overflowing endpoint', '1.7e308', '1e308', 'LINEAR_EXACT'],
    ['rounded equal endpoints', '1e20', '2', 'LINEAR_EXACT'],
    ['underflowing half-width', '0', '5e-324', 'LINEAR_EXACT'],
  ] as const)('rejects %s', (_name, center, width, voiFunction) => {
    expect(
      getConsistentDicomWindowRange([windowTags(center, width, voiFunction)])
    ).toBeUndefined();
  });
});
