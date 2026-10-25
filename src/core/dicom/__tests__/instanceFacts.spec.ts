import { describe, expect, it } from 'vitest';
import { Tags } from '@/src/core/dicomTags';
import { readInstanceFacts, seriesKeyOf } from '@/src/core/dicom/instanceFacts';

const INSTANCE_NUMBER_TAG = '0020|0013';

// readDicomTags hands back DICOM's own padding, so every fixture value here is
// written the way the reader returns it.
const metadata = (overrides: Record<string, string> = {}) => {
  const entries: Array<[string, string]> = [
    [Tags.SOPInstanceUID, '1.2.3.4'],
    [Tags.SeriesInstanceUID, '1.2.3'],
    [Tags.StudyInstanceUID, '1.2'],
    [Tags.PatientID, 'patient-1'],
    [Tags.SeriesNumber, '1 '],
    [Tags.SliceThickness, '1 '],
    [Tags.SeriesDate, '20240101'],
    [Tags.Rows, '4'],
    [Tags.Columns, '6'],
    [Tags.SamplesPerPixel, '1'],
    [Tags.ImageOrientationPatient, '1\\0\\0\\0\\1\\0 '],
    [Tags.ImagePositionPatient, '10\\20\\30 '],
    [Tags.PixelSpacing, '0.5\\0.75'],
    [INSTANCE_NUMBER_TAG, '5 '],
  ];
  Object.entries(overrides).forEach(([tag, value]) => {
    const existing = entries.find((entry) => entry[0] === tag);
    if (existing) existing[1] = value;
    else entries.push([tag, value]);
  });
  return entries;
};

const without = (tag: string) => metadata().filter((entry) => entry[0] !== tag);

describe('readInstanceFacts', () => {
  it('names the instance number tag the planner orders on', () => {
    expect(Tags.InstanceNumber).toBe(INSTANCE_NUMBER_TAG);
  });

  it('reads every fact the planner compares', () => {
    expect(readInstanceFacts(metadata())).toEqual({
      sopInstanceUid: '1.2.3.4',
      seriesInstanceUid: '1.2.3',
      seriesNumber: '1',
      sequenceName: null,
      sliceThickness: '1',
      seriesDate: '20240101',
      rows: '4',
      columns: '6',
      samplesPerPixel: '1',
      numberOfFrames: null,
      orientation: [1, 0, 0, 0, 1, 0],
      position: [10, 20, 30],
      projectedPosition: 30,
      pixelSpacing: [0.5, 0.75],
      instanceNumber: 5,
      acquisitionNumber: null,
      temporalPositionIdentifier: null,
      echoNumbers: null,
      diffusionBValue: null,
    });
  });

  it('reads an instance with no tags at all as entirely unknown', () => {
    expect(readInstanceFacts([])).toEqual({
      sopInstanceUid: null,
      seriesInstanceUid: null,
      seriesNumber: null,
      sequenceName: null,
      sliceThickness: null,
      seriesDate: null,
      rows: null,
      columns: null,
      samplesPerPixel: null,
      numberOfFrames: null,
      orientation: null,
      position: null,
      projectedPosition: null,
      pixelSpacing: null,
      instanceNumber: null,
      acquisitionNumber: null,
      temporalPositionIdentifier: null,
      echoNumbers: null,
      diffusionBValue: null,
    });
  });

  it.each([
    ['SeriesNumber', Tags.SeriesNumber, 'seriesNumber'],
    ['SequenceName', Tags.SequenceName, 'sequenceName'],
    ['SliceThickness', Tags.SliceThickness, 'sliceThickness'],
    ['SeriesDate', Tags.SeriesDate, 'seriesDate'],
    ['Rows', Tags.Rows, 'rows'],
    ['Columns', Tags.Columns, 'columns'],
    ['SamplesPerPixel', Tags.SamplesPerPixel, 'samplesPerPixel'],
    ['NumberOfFrames', Tags.NumberOfFrames, 'numberOfFrames'],
  ] as const)(
    'reads a zero length %s as absent, not as an empty string',
    (_name, tag, fact) => {
      expect(readInstanceFacts(metadata({ [tag]: '' }))[fact]).toBeNull();
      expect(readInstanceFacts(metadata({ [tag]: '  ' }))[fact]).toBeNull();
    }
  );

  it.each([
    ['SeriesNumber', Tags.SeriesNumber, 'seriesNumber'],
    ['SliceThickness', Tags.SliceThickness, 'sliceThickness'],
    ['Rows', Tags.Rows, 'rows'],
    ['Columns', Tags.Columns, 'columns'],
    ['SamplesPerPixel', Tags.SamplesPerPixel, 'samplesPerPixel'],
    ['NumberOfFrames', Tags.NumberOfFrames, 'numberOfFrames'],
  ] as const)(
    'normalizes the numeric spelling of %s so 04 and 4.0 are one value',
    (_name, tag, fact) => {
      const readFact = (value: string) =>
        readInstanceFacts(metadata({ [tag]: value }))[fact];
      expect(readFact('4')).toBe('4');
      expect(readFact('04')).toBe('4');
      expect(readFact('4.0')).toBe('4');
      expect(readFact(' 4 ')).toBe('4');
      expect(readFact('1.50')).toBe('1.5');
    }
  );

  // A study date's leading zeros are part of the value, so it stays text.
  it('keeps a series date as text rather than as a number', () => {
    expect(
      readInstanceFacts(metadata({ [Tags.SeriesDate]: '00240101 ' })).seriesDate
    ).toBe('00240101');
  });

  it('keeps a sequence name as text', () => {
    expect(
      readInstanceFacts(metadata({ [Tags.SequenceName]: '007 ' })).sequenceName
    ).toBe('007');
  });

  it('trims the padding DICOM adds to odd length identifiers', () => {
    const facts = readInstanceFacts(
      metadata({
        [Tags.SOPInstanceUID]: '1.2.3.4 ',
        [Tags.SeriesInstanceUID]: '1.2.3 ',
      })
    );
    expect(facts.sopInstanceUid).toBe('1.2.3.4');
    expect(facts.seriesInstanceUid).toBe('1.2.3');
  });

  it.each([
    ['a missing tag', without(Tags.ImageOrientationPatient)],
    [
      'too few cosines',
      metadata({ [Tags.ImageOrientationPatient]: '1\\0\\0' }),
    ],
    [
      'a non numeric cosine',
      metadata({ [Tags.ImageOrientationPatient]: '1\\0\\0\\0\\x\\0' }),
    ],
  ])('reads an orientation with %s as unknown', (_case, entries) => {
    const facts = readInstanceFacts(entries);
    expect(facts.orientation).toBeNull();
    expect(facts.projectedPosition).toBeNull();
  });

  it.each([
    ['a missing tag', without(Tags.ImagePositionPatient)],
    ['too few coordinates', metadata({ [Tags.ImagePositionPatient]: '1\\2' })],
    [
      'a non numeric coordinate',
      metadata({ [Tags.ImagePositionPatient]: '1\\2\\z' }),
    ],
  ])('reads a position with %s as unknown', (_case, entries) => {
    const facts = readInstanceFacts(entries);
    expect(facts.position).toBeNull();
    expect(facts.projectedPosition).toBeNull();
  });

  it.each([
    ['a blank component', '1\\\\3'],
    ['a trailing blank component', '1\\2\\'],
    ['a whitespace component', '1\\ \\3'],
  ])('reads a position with %s as unknown, not as a zero', (_case, value) => {
    const facts = readInstanceFacts(
      metadata({ [Tags.ImagePositionPatient]: value })
    );
    expect(facts.position).toBeNull();
    expect(facts.projectedPosition).toBeNull();
  });

  it.each([
    ['an all zero basis', '0\\0\\0\\0\\0\\0'],
    ['a zero length row', '0\\0\\0\\0\\1\\0'],
    ['a row and column that are the same axis', '1\\0\\0\\1\\0\\0'],
    ['a row and column 45 degrees apart', '1\\0\\0\\0.7071\\0.7071\\0'],
    ['a blank cosine', '1\\0\\0\\0\\\\0'],
  ])('reads %s as no orientation at all', (_case, value) => {
    const facts = readInstanceFacts(
      metadata({ [Tags.ImageOrientationPatient]: value })
    );
    expect(facts.orientation).toBeNull();
    expect(facts.projectedPosition).toBeNull();
  });

  // A DS value carries a printed decimal, so exact unit length is not on offer.
  it('normalizes cosines that are within the tolerance of unit length', () => {
    const facts = readInstanceFacts(
      metadata({
        [Tags.ImageOrientationPatient]: '0.99998\\0\\0\\0\\1.00002\\0',
      })
    );

    expect(facts.orientation).not.toBeNull();
    expect(facts.orientation![0]).toBeCloseTo(1, 12);
    expect(facts.orientation![4]).toBeCloseTo(1, 12);
    expect(facts.projectedPosition).toBeCloseTo(30, 12);
  });

  // GDCM rescales whatever cosines it is given, so a basis printed to three
  // decimals or written at the wrong length loads as the scanner meant it
  // rather than landing in the unreadable bucket.
  it.each([
    [
      'an oblique printed to three decimals',
      '0.707\\0.707\\0\\-0.707\\0.707\\0',
      [0.7071, 0.7071, 0, -0.7071, 0.7071, 0],
    ],
    [
      'a row written at twice unit length',
      '2\\0\\0\\0\\1\\0',
      [1, 0, 0, 0, 1, 0],
    ],
  ])('rescales %s to unit axes', (_case, value, expected) => {
    const facts = readInstanceFacts(
      metadata({ [Tags.ImageOrientationPatient]: value })
    );

    expect(facts.orientation).not.toBeNull();
    facts.orientation!.forEach((cosine, index) =>
      expect(cosine).toBeCloseTo(expected[index], 3)
    );
    expect(facts.projectedPosition).toBeCloseTo(30, 10);
  });

  it('accepts cosines a printed digit away from square', () => {
    const facts = readInstanceFacts(
      metadata({
        [Tags.ImageOrientationPatient]: '0.7071\\0.7071\\0\\-0.7072\\0.7070\\0',
      })
    );

    expect(facts.orientation).not.toBeNull();
    expect(facts.projectedPosition).toBeCloseTo(30, 3);
  });

  it.each([
    ['zero', '0\\0.5'],
    ['negative', '-1\\0.5'],
    ['blank', '\\0.5'],
  ])('reads a %s pixel spacing as unknown', (_case, value) => {
    expect(
      readInstanceFacts(metadata({ [Tags.PixelSpacing]: value })).pixelSpacing
    ).toBeNull();
  });

  it('projects the position onto the slice normal, not onto z', () => {
    // Rows run along +y and columns along +z, so the normal is +x.
    const facts = readInstanceFacts(
      metadata({ [Tags.ImageOrientationPatient]: '0\\1\\0\\0\\0\\1' })
    );
    expect(facts.projectedPosition).toBeCloseTo(10, 10);
  });

  it('projects onto the normal with the cosines in row then column order', () => {
    // Swapping the two rows of the case above flips the normal to -x.
    const facts = readInstanceFacts(
      metadata({ [Tags.ImageOrientationPatient]: '0\\0\\1\\0\\1\\0' })
    );
    expect(facts.projectedPosition).toBeCloseTo(-10, 10);
  });

  it.each([
    ['a missing tag', without(Tags.PixelSpacing), null],
    ['a single value', metadata({ [Tags.PixelSpacing]: '0.5' }), null],
    [
      'a non numeric value',
      metadata({ [Tags.PixelSpacing]: '0.5\\bad' }),
      null,
    ],
  ])('reads a pixel spacing with %s as unknown', (_case, entries) => {
    expect(readInstanceFacts(entries).pixelSpacing).toBeNull();
  });

  it.each([
    ['5 ', 5],
    ['+5', 5],
    ['-3', -3],
  ])('reads the instance number %s as a number', (value, expected) => {
    expect(
      readInstanceFacts(metadata({ [INSTANCE_NUMBER_TAG]: value }))
        .instanceNumber
    ).toBe(expected);
  });

  it.each([
    ['a missing tag', without(INSTANCE_NUMBER_TAG)],
    ['an empty value', metadata({ [INSTANCE_NUMBER_TAG]: ' ' })],
    ['a non numeric value', metadata({ [INSTANCE_NUMBER_TAG]: 'first' })],
  ])('reads an instance number with %s as unknown', (_case, entries) => {
    expect(readInstanceFacts(entries).instanceNumber).toBeNull();
  });

  it('does not mutate the metadata it reads', () => {
    const entries = metadata();
    const before = JSON.parse(JSON.stringify(entries));
    readInstanceFacts(entries);
    expect(entries).toEqual(before);
  });
});

describe('seriesKeyOf', () => {
  it('is the series instance uid so a collection id carries it as a prefix', () => {
    expect(seriesKeyOf(metadata())).toBe('1.2.3');
    expect(seriesKeyOf(metadata({ [Tags.SeriesInstanceUID]: '1.2.3 ' }))).toBe(
      '1.2.3'
    );
  });

  it('separates two series that differ only in series instance uid', () => {
    expect(
      seriesKeyOf(metadata({ [Tags.SeriesInstanceUID]: '1.2.4' }))
    ).not.toBe(seriesKeyOf(metadata()));
  });

  it('never reuses a series key for an instance that has no series uid', () => {
    const anonymous = seriesKeyOf(metadata({ [Tags.SeriesInstanceUID]: '' }));
    expect(anonymous).not.toBe('');
    expect(anonymous).not.toBe(seriesKeyOf(metadata()));
  });

  it('falls back to the study and patient when the series uid is absent', () => {
    const key = (overrides: Record<string, string>) =>
      seriesKeyOf(metadata({ [Tags.SeriesInstanceUID]: '', ...overrides }));

    expect(key({})).toBe(key({}));
    expect(key({ [Tags.StudyInstanceUID]: '9.9' })).not.toBe(key({}));
    expect(key({ [Tags.PatientID]: 'patient-2' })).not.toBe(key({}));
  });

  // Concatenation alone would tie these two, since only the split moves.
  it('escapes the fallback parts so a moved separator changes the key', () => {
    const key = (study: string, patient: string) =>
      seriesKeyOf(
        metadata({
          [Tags.SeriesInstanceUID]: '',
          [Tags.StudyInstanceUID]: study,
          [Tags.PatientID]: patient,
        })
      );
    expect(key('a|b', 'c')).not.toBe(key('a', 'b|c'));
    expect(key('a:b', 'c')).not.toBe(key('a', 'b:c'));
  });

  it('does not mutate the metadata it reads', () => {
    const entries = metadata();
    const before = JSON.parse(JSON.stringify(entries));
    seriesKeyOf(entries);
    expect(entries).toEqual(before);
  });
});
