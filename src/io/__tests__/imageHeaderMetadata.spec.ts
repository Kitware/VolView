import { describe, expect, it } from 'vitest';
import {
  CALIBRATED_SPACING_AXES,
  imageHeaderMetadata,
} from '@/src/io/imageHeaderMetadata';

const directions = 'space directions: (0.03,0,0) (0,0.01,0) (0,0,0.2)';
const spacings = 'spacings: 0.03 0.01 0.2';
const axisUnits = 'units: "mm" "mm" "mm"';
const spaceUnits = 'space units: "mm" "mm" "mm"';

async function calibration(fields: string[], spacing = [0.03, 0.01, 0.2]) {
  const file = new File(
    [['NRRD0005', ...fields, '', ''].join('\n')],
    'volume.nrrd'
  );
  const metadata = await imageHeaderMetadata(file, {
    spacing,
    metadata: new Map([['ITK_InputFilterName', 'NrrdImageIO']]),
  });
  return metadata.get(CALIBRATED_SPACING_AXES);
}

describe('NRRD calibration declarations', () => {
  it.each([
    { fields: [spacings, axisUnits], expected: '1,1,1' },
    {
      fields: [spacings, 'units: "millimetres" "unknown" "MM"'],
      expected: '1,0,1',
    },
    { fields: [spacings, spaceUnits], expected: '0,0,0' },
    { fields: [directions, spaceUnits], expected: '1,1,1' },
    { fields: [directions, axisUnits], expected: '0,0,0' },
    {
      fields: [
        'space directions: (0,0.03,0) (0.01,0,0) (0,0,0.2)',
        'space units: "mm" "unknown" "mm"',
        axisUnits,
      ],
      expected: '0,1,1',
    },
    { fields: [spacings], expected: '0,0,0' },
    { fields: [spacings, 'units: "um" "um" "um"'], expected: '0,0,0' },
  ])(
    'keeps axis and coordinate units separate: $fields',
    async ({ fields, expected }) => {
      expect(await calibration(fields)).toBe(expected);
    }
  );

  it('requires positive finite declared spacings before any reader repairs', async () => {
    expect(await calibration(['spacings: 0 -0.01 NaN', axisUnits])).toBe(
      '0,0,0'
    );
  });

  it('also requires usable reader spacings', async () => {
    expect(await calibration([spacings, axisUnits], [0, -1, Infinity])).toBe(
      '0,0,0'
    );
  });

  it('leaves headers beyond the bounded inspection prefix uncalibrated', async () => {
    expect(
      await calibration([`#${' '.repeat(65536)}`, spacings, axisUnits])
    ).toBe('0,0,0');
  });
});
