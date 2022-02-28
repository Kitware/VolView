import { computed, Ref } from '@vue/composition-api';
import { mat3, vec3 } from 'gl-matrix';

export interface LPSAxesToColumns {
  Coronal: number;
  Sagittal: number;
  Axial: number;
}

export interface LPSDirections {
  Coronal: vec3;
  Sagittal: vec3;
  Axial: vec3;
}

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
export function assignColsToLPS(direction: mat3): LPSAxesToColumns {
  // Track the rows and columns that have yet to be assigned.
  const availableCols = [0, 1, 2];
  const availableRows = [0, 1, 2];
  const lps = {
    Coronal: 0,
    Sagittal: 1,
    Axial: 2,
  };

  // axis: 0,1,2 -> Coronal,Sagittal,Axial
  type AxisOrder = ['Coronal', 'Sagittal', 'Axial'];
  const axisOrder: AxisOrder = ['Coronal', 'Sagittal', 'Axial'];

  for (let i = 0; i < 3; i++) {
    let maxValue = -Infinity;
    let maxIndex = [0, 0]; // col, row
    let removeAxes = [0, 0]; // indices into availableCols/Rows for deletion

    availableCols.forEach((col, colIdx) => {
      availableRows.forEach((row, rowIdx) => {
        const value = Math.abs(direction[col * 3 + row]);
        if (value > maxValue) {
          maxValue = value;
          maxIndex = [col, row];
          removeAxes = [colIdx, rowIdx];
        }
      });
    });

    // the row index corresponds to index of LPS axes
    const [col, axis] = maxIndex;
    lps[axisOrder[axis]] = col;

    availableCols.splice(removeAxes[0], 1);
    availableRows.splice(removeAxes[1], 1);
  }

  return lps;
}

export function useLPSDirections(directionRef: Ref<mat3>) {
  const lpsAssignments = computed(() => assignColsToLPS(directionRef.value));
  const lpsDirections = computed(() => {
    const mat = directionRef.value;
    const assignments = lpsAssignments.value;
    return {
      Coronal: mat.slice(
        assignments.Coronal * 3,
        (assignments.Coronal + 1) * 3
      ) as vec3,
      Sagittal: mat.slice(
        assignments.Sagittal * 3,
        (assignments.Sagittal + 1) * 3
      ) as vec3,
      Axial: mat.slice(
        assignments.Axial * 3,
        (assignments.Axial + 1) * 3
      ) as vec3,
    };
  });

  return { lpsAssignments, lpsDirections };
}
