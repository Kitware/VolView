import type { Bounds } from '@kitware/vtk.js/types';
import { vec3, mat3 } from 'gl-matrix';
import { ViewTypes } from '@kitware/vtk.js/Widgets/Core/WidgetManager/Constants';
import {
  LPSAxis,
  LPSAxisDir,
  LPSBounds,
  LPSDirections,
  LPSPoint,
} from '../types/lps';

export const LPSAxes: LPSAxis[] = ['Sagittal', 'Coronal', 'Axial'];

export function createLPSPoint(): LPSPoint {
  return {
    Sagittal: 0,
    Coronal: 0,
    Axial: 0,
  };
}

export function createLPSBounds(): LPSBounds {
  return {
    Sagittal: [0, 0],
    Coronal: [0, 0],
    Axial: [0, 0],
  };
}

export function getAxisBounds(
  bounds: Bounds,
  axis: LPSAxis,
  directions: LPSDirections
) {
  const index = 2 * directions[axis];
  return bounds.slice(index, index + 2) as [number, number];
}

export function getLPSAxisFromDir(dir: LPSAxisDir): LPSAxis {
  switch (dir) {
    case 'Superior':
    case 'Inferior':
      return 'Axial';
    case 'Left':
    case 'Right':
      return 'Sagittal';
    case 'Posterior':
    case 'Anterior':
      return 'Coronal';
    default:
      throw new Error(`Invalid LPS direction: ${dir}`);
  }
}

export function getVTKViewTypeFromLPSAxis(axis: LPSAxis): ViewTypes {
  switch(axis) {
    case 'Sagittal': return ViewTypes.YZ_PLANE;
    case 'Coronal': return ViewTypes.XZ_PLANE;
    case 'Axial': return ViewTypes.XY_PLANE;
    default:
      throw new Error(`Invalid LPS axis: ${axis}`);
  }
}

export const defaultLPSDirections = () => ({
  Left: vec3.fromValues(1, 0, 0),
  Right: vec3.fromValues(-1, 0, 0),
  Posterior: vec3.fromValues(0, 1, 0),
  Anterior: vec3.fromValues(0, -1, 0),
  Superior: vec3.fromValues(0, 0, 1),
  Inferior: vec3.fromValues(0, 0, -1),

  Sagittal: 0 as const,
  Coronal: 1 as const,
  Axial: 2 as const,
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
      // Sagittal
      lpsDirs.Left = posVector;
      lpsDirs.Right = negVector;
      lpsDirs.Sagittal = col as 0 | 1 | 2;
    } else if (axis === 1) {
      // Coronal
      lpsDirs.Posterior = posVector;
      lpsDirs.Anterior = negVector;
      lpsDirs.Coronal = col as 0 | 1 | 2;
    } else if (axis === 2) {
      // Axial
      lpsDirs.Superior = posVector;
      lpsDirs.Inferior = negVector;
      lpsDirs.Axial = col as 0 | 1 | 2;
    }

    availableCols.splice(removeIndices[0], 1);
    availableRows.splice(removeIndices[1], 1);
  }

  return lpsDirs;
}
