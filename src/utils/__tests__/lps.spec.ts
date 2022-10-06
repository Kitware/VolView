import chai, { expect } from 'chai';
import chaiAlmost from 'chai-almost';
import { vec3, mat3 } from 'gl-matrix';

import { getLPSDirections } from '@src/utils/lps';

chai.use(chaiAlmost());

describe('getLPSDirections', () => {
  it('correctly assigns LPS directions from an orientation', () => {
    // Only need 3 of the 6 due to negation
    interface Expected {
      Left: vec3;
      Posterior: vec3;
      Superior: vec3;
      Coronal: number;
      Sagittal: number;
      Axial: number;
    }

    function evaluate(desc: string, mat: mat3, expected: Expected) {
      const actual = getLPSDirections(mat);

      expect(actual.Coronal, `${desc}: Coronal`).to.equal(expected.Coronal);
      expect(actual.Sagittal, `${desc}: Coronal`).to.equal(expected.Sagittal);
      expect(actual.Axial, `${desc}: Coronal`).to.equal(expected.Axial);

      expect(actual.Left, `${desc}: Left`).to.deep.almost(expected.Left);
      expect(actual.Right, `${desc}: Right`).to.deep.almost(
        expected.Left.map((c) => c * -1)
      );
      expect(actual.Posterior, `${desc}: Posterior`).to.deep.almost(
        expected.Posterior
      );
      expect(actual.Anterior, `${desc}: Anterior`).to.deep.almost(
        expected.Posterior.map((c) => c * -1)
      );
      expect(actual.Superior, `${desc}: Superior`).to.deep.almost(
        expected.Superior
      );
      expect(actual.Inferior, `${desc}: Inferior`).to.deep.almost(
        expected.Superior.map((c) => c * -1)
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
        Left: [1, 0, 0],
        Posterior: [0, 1, 0],
        Superior: [0, 0, 1],
        Coronal: 0,
        Sagittal: 1,
        Axial: 2,
      }
    );
    evaluate(
      'Axis-aligned case #1',
      // prettier-ignore
      [
        0,  0, -1,
        1,  0,  0,
        0, -1,  0,
      ],
      {
        Left: [1, 0, 0],
        Posterior: [0, 1, 0],
        Superior: [0, 0, 1],
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
        Left: [0.5627936124801636, 0.5630670785903931, 0.6051601767539978],
        Posterior: [
          -0.569969654083252, 0.7945769429206848, -0.20924176275730133,
        ],
        Superior: [
          -0.5986634492874146, -0.22716301679611206, 0.7681139707565308,
        ],
        Coronal: 1,
        Sagittal: 2,
        Axial: 0,
      }
    );
  });
});
