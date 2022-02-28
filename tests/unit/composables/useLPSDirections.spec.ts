import { expect } from 'chai';
import { mat3 } from 'gl-matrix';

import { assignColsToLPS } from '@src/composables/useLPSDirections';

describe('assignColVecsToLPS', () => {
  it('correctly assigns column vectors to LPS directions', () => {
    // Assignments maps LPS directions to column indices
    interface Assignments {
      Coronal: number;
      Sagittal: number;
      Axial: number;
    }

    function evaluate(
      desc: string,
      mat: mat3,
      expectedAssignments: Assignments
    ) {
      const actual = assignColsToLPS(mat);
      expect(actual.Coronal, `${desc} failed (Coronal)`).to.deep.equal(
        expectedAssignments.Coronal
      );
      expect(actual.Sagittal, `${desc} failed (Sagittal)`).to.deep.equal(
        expectedAssignments.Sagittal
      );
      expect(actual.Axial, `${desc} failed (Axial)`).to.deep.equal(
        expectedAssignments.Axial
      );
    }

    evaluate(
      'Identity',
      // prettier-ignore
      [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
      ],
      {
        Coronal: 0,
        Sagittal: 1,
        Axial: 2,
      }
    );
    evaluate(
      'Axis-aligned case #1',
      // prettier-ignore
      [
        0, 0, 1,
        1, 0, 0,
        0, 1, 0,
      ],
      {
        Coronal: 1,
        Sagittal: 2,
        Axial: 0,
      }
    );
    evaluate(
      'Oblique case #1',
      // prettier-ignore
      [
        0.5986634492874146, 0.22716301679611206, -0.7681139707565308,
        0.5627936124801636, 0.5630670785903931 , 0.6051601767539978,
        0.569969654083252 , -0.7945769429206848, 0.20924176275730133,
      ],
      {
        Coronal: 1,
        Sagittal: 2,
        Axial: 0,
      }
    );
  });
});
