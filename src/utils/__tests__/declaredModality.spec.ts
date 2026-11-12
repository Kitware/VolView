import { describe, expect, it } from 'vitest';
import { getDeclaredModality } from '@/src/utils/declaredModality';

describe('getDeclaredModality', () => {
  it('prefers the DICOM modality over header fields', () => {
    expect(getDeclaredModality(' mr ', [['modality', 'CT']])).toBe('MR');
  });

  it('reads the modality tag before a plain modality field', () => {
    expect(
      getDeclaredModality(undefined, [
        ['Modality', 'us'],
        ['0008|0060', 'MR'],
      ])
    ).toBe('MR');
    expect(getDeclaredModality('', [[' Modality ', ' us ']])).toBe('US');
  });

  it('reads MetaImage modality names', () => {
    expect(getDeclaredModality(undefined, [['Modality', 'MET_MOD_MR']])).toBe(
      'MR'
    );
  });

  it('treats Hounsfield scalar units as CT', () => {
    expect(getDeclaredModality(undefined, [['0028|1054', 'HU']])).toBe('CT');
    expect(getDeclaredModality(undefined, [['RescaleType', 'hu']])).toBe('CT');
    expect(
      getDeclaredModality(undefined, [['IntensityUnits', 'Hounsfield Units']])
    ).toBe('CT');
  });

  it('keeps an explicit modality even when units are Hounsfield', () => {
    expect(
      getDeclaredModality(undefined, [
        ['modality', 'OT'],
        ['IntensityUnits', 'HU'],
      ])
    ).toBe('OT');
  });

  it('declares nothing for other units or no metadata', () => {
    expect(getDeclaredModality(undefined, [['IntensityUnits', 'mm']])).toBe('');
    expect(getDeclaredModality(undefined)).toBe('');
  });
});
