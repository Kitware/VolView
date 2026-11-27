import { describe, expect, it } from 'vitest';
import { readModalityRescale } from '../modalityRescale';
import {
  enhanced,
  groups,
  sequence,
  tags,
} from '../../volume/__tests__/enhancedFixture';

const transform = (slope: string, intercept: string) =>
  groups([
    sequence('00289145', [tags({ '00281053': slope, '00281052': intercept })]),
  ]);

const multiframe = (
  sopClassUid: string,
  frames = [transform('3', '-500'), transform('3', '-500')],
  root: Record<string, string> = { '00281053': '2', '00281052': '-1000' }
) => enhanced(groups([]), frames, { '00080016': sopClassUid, ...root });

const TOP_LEVEL = { rescaleSlope: 2, rescaleIntercept: -1000 };
const FUNCTIONAL_GROUP = { rescaleSlope: 3, rescaleIntercept: -500 };

// Each class was read by GDCM with both rescales present.
describe('readModalityRescale', () => {
  it.each([
    ['Enhanced CT', '1.2.840.10008.5.1.4.1.1.2.1'],
    ['Legacy Converted Enhanced CT', '1.2.840.10008.5.1.4.1.1.2.2'],
    ['Enhanced MR', '1.2.840.10008.5.1.4.1.1.4.1'],
    ['Legacy Converted Enhanced MR', '1.2.840.10008.5.1.4.1.1.4.4'],
    ['Enhanced PET', '1.2.840.10008.5.1.4.1.1.130'],
    ['Legacy Converted Enhanced PET', '1.2.840.10008.5.1.4.1.1.128.1'],
    ['X-Ray 3D Angiographic', '1.2.840.10008.5.1.4.1.1.13.1.1'],
    ['X-Ray 3D Craniofacial', '1.2.840.10008.5.1.4.1.1.13.1.2'],
    ['Breast Tomosynthesis', '1.2.840.10008.5.1.4.1.1.13.1.3'],
    ['Breast Projection For Presentation', '1.2.840.10008.5.1.4.1.1.13.1.4'],
    ['Breast Projection For Processing', '1.2.840.10008.5.1.4.1.1.13.1.5'],
    ['Segmentation', '1.2.840.10008.5.1.4.1.1.66.4'],
  ])('reads the functional group transform of %s', (_name, sopClassUid) => {
    expect(readModalityRescale(multiframe(sopClassUid))).toEqual(
      FUNCTIONAL_GROUP
    );
  });

  it.each([
    ['Multi-frame Grayscale Word SC', '1.2.840.10008.5.1.4.1.1.7.3'],
    ['Ophthalmic Tomography', '1.2.840.10008.5.1.4.1.1.77.1.5.4'],
    ['Enhanced US Volume', '1.2.840.10008.5.1.4.1.1.6.2'],
    ['Enhanced XA', '1.2.840.10008.5.1.4.1.1.12.1.1'],
    ['Enhanced MR Color', '1.2.840.10008.5.1.4.1.1.4.3'],
    ['Intravascular OCT', '1.2.840.10008.5.1.4.1.1.14.1'],
    ['CT', '1.2.840.10008.5.1.4.1.1.2'],
    ['MR', '1.2.840.10008.5.1.4.1.1.4'],
    ['NM', '1.2.840.10008.5.1.4.1.1.20'],
    ['RT Dose', '1.2.840.10008.5.1.4.1.1.481.2'],
  ])('reads the top-level rescale of %s', (_name, sopClassUid) => {
    expect(readModalityRescale(multiframe(sopClassUid))).toEqual(TOP_LEVEL);
  });

  it('falls back to the top-level rescale of an enhanced class', () => {
    const dataset = multiframe('1.2.840.10008.5.1.4.1.1.2.1', [
      groups([]),
      groups([]),
    ]);
    expect(readModalityRescale(dataset)).toEqual(TOP_LEVEL);
  });

  it('applies no rescale when only an unread functional group has one', () => {
    const dataset = multiframe('1.2.840.10008.5.1.4.1.1.7.3', undefined, {});
    expect(readModalityRescale(dataset)).toEqual({
      rescaleSlope: 1,
      rescaleIntercept: 0,
    });
  });
});
