import { vec3, mat3 } from 'gl-matrix';

export type LPSAxis = 'Axial' | 'Sagittal' | 'Coronal';

export type LPSAxisDir =
  | 'Left'
  | 'Right'
  | 'Posterior'
  | 'Anterior'
  | 'Superior'
  | 'Inferior';

export function getLPSAxisFromDir(dir: LPSAxisDir): LPSAxis {
  switch (dir) {
    case 'Superior':
    case 'Inferior':
      return 'Axial';
    case 'Left':
    case 'Right':
      return 'Coronal';
    case 'Posterior':
    case 'Anterior':
      return 'Sagittal';
    default:
      throw new Error(`Invalid LPS direction: ${dir}`);
  }
}

export interface LPSDirections {
  // Maps LPS direction to world-space direction (not index-space direction)
  // These should match columns of the current image orientation matrix.
  Left: vec3;
  Right: vec3;
  Posterior: vec3;
  Anterior: vec3;
  Superior: vec3;
  Inferior: vec3;

  // maps LPS axis to column in direction matrix
  Coronal: number;
  Sagittal: number;
  Axial: number;
}

export const defaultLPSDirections = () => ({
  Left: vec3.fromValues(1, 0, 0),
  Right: vec3.fromValues(-1, 0, 0),
  Posterior: vec3.fromValues(0, 1, 0),
  Anterior: vec3.fromValues(0, -1, 0),
  Superior: vec3.fromValues(0, 0, 1),
  Inferior: vec3.fromValues(0, 0, -1),

  Coronal: 0,
  Sagittal: 1,
  Axial: 2,
});

/**
 * Associates the column vectors of a 3x3 matrix with the LPS axes.
 *
 * For each of the LPS axes, this function returns the associated column index (0, 1, 2)
 * in the provided 3x3 column-major matrix.
 *
 * Approach:
 *   - find the max of the direction matrix, ignoring columns and rows marked as done
 *   - assign the column vector of that max value to the row axis
 *   - mark that row and column as done
 *   - continue until all rows and columns are done
 */
export function getLPSDirections(direction: mat3): LPSDirections {
  // Track the rows and columns that have yet to be assigned.
  const availableCols = [0, 1, 2];
  const availableRows = [0, 1, 2];
  const lpsDirs: LPSDirections = defaultLPSDirections();

  for (let i = 0; i < 3; i++) {
    let bestValue = 0;
    let bestValueLoc = [0, 0]; // col, row
    let removeIndices = [0, 0]; // indices into availableCols/Rows for deletion

    availableCols.forEach((col, colIdx) => {
      availableRows.forEach((row, rowIdx) => {
        const value = direction[col * 3 + row];
        if (Math.abs(value) > Math.abs(bestValue)) {
          bestValue = value;
          bestValueLoc = [col, row];
          removeIndices = [colIdx, rowIdx];
        }
      });
    });

    // the row index corresponds to the index of the LPS axis
    const [col, axis] = bestValueLoc;
    const axisVector = direction.slice(col * 3, (col + 1) * 3);
    const vecSign = Math.sign(bestValue);
    const posVector = axisVector.map((c) => c * vecSign) as vec3;
    const negVector = axisVector.map((c) => c * -vecSign) as vec3;
    if (axis === 0) {
      // Coronal
      lpsDirs.Left = posVector;
      lpsDirs.Right = negVector;
      lpsDirs.Coronal = col;
    } else if (axis === 1) {
      // Sagittal
      lpsDirs.Posterior = posVector;
      lpsDirs.Anterior = negVector;
      lpsDirs.Sagittal = col;
    } else if (axis === 2) {
      // Axial
      lpsDirs.Superior = posVector;
      lpsDirs.Inferior = negVector;
      lpsDirs.Axial = col;
    }

    availableCols.splice(removeIndices[0], 1);
    availableRows.splice(removeIndices[1], 1);
  }

  return lpsDirs;
}
