/*
File modified from https://github.com/cornerstonejs/cornerstone3D/blob/main/packages/tools/src/utilities/math/polyline/decimate.ts

MIT License

Copyright (c) 2019 Open Health Imaging Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import { Vector3 } from '@kitware/vtk.js/types';
import vtkLine from '@kitware/vtk.js/Common/DataModel/Line';

const DEFAULT_EPSILON = 0.1;

type Line = Array<Vector3>;

/**
 * Ramer–Douglas–Peucker algorithm implementation to decimate a polyline
 * to a similar polyline with fewer points
 *
 * https://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm
 * https://rosettacode.org/wiki/Ramer-Douglas-Peucker_line_simplification
 * https://karthaus.nl/rdp/
 *
 * @param polyline - Polyline to decimate
 * @param epsilon - A maximum given distance 'epsilon' to decide if a point
 * should or shouldn't be added the decimated polyline version. In each
 * iteration the polyline is split into two polylines and the distance of each
 * point from those new polylines are checked against the line that connects
 * the first and last points.
 * @returns Decimated polyline
 */
export default function decimate(polyline: Line, epsilon = DEFAULT_EPSILON) {
  const numPoints = polyline.length;

  // The polyline must have at least a start and end points
  if (numPoints < 3) {
    return polyline;
  }

  const epsilonSquared = epsilon * epsilon;
  const partitionQueue = [[0, numPoints - 1]];

  // Used a boolean array to set each point that will be in the decimated polyline
  // because pre-allocated arrays are 3-4x faster than thousands of push() calls
  // to add all points to a new array.
  const polylinePointFlags = new Array(numPoints).fill(false);

  // Start and end points are always added to the decimated polyline
  let numDecimatedPoints = 2;

  // Add start and end points to the decimated polyline
  polylinePointFlags[0] = true;
  polylinePointFlags[numPoints - 1] = true;

  // Iterative approach using a queue instead of recursion to reduce the number
  // of function calls (performance)
  while (partitionQueue.length) {
    const [startIndex, endIndex] = partitionQueue.pop()!;

    // Return if there is no point between the start and end points
    if (endIndex - startIndex === 1) {
      continue;
    }

    const startPoint = polyline[startIndex];
    const endPoint = polyline[endIndex];
    let maxDistSquared = -Infinity;
    let maxDistIndex = -1;

    // Search for the furthest point
    for (let i = startIndex + 1; i < endIndex; i++) {
      const currentPoint = polyline[i];
      const { distance: distSquared } = vtkLine.distanceToLine(
        currentPoint,
        startPoint,
        endPoint
      );

      if (distSquared > maxDistSquared) {
        maxDistSquared = distSquared;
        maxDistIndex = i;
      }
    }

    // Do not add any of the points because the fursthest one is very close to
    // the line based on the epsilon value
    if (maxDistSquared < epsilonSquared) {
      continue;
    }

    // Update the flag for the furthest point because it will be added to the
    // decimated polyline
    polylinePointFlags[maxDistIndex] = true;
    numDecimatedPoints++;

    // Partition the points into two parts using maxDistIndex as the pivot point
    // and process both sides
    partitionQueue.push([maxDistIndex, endIndex]);
    partitionQueue.push([startIndex, maxDistIndex]);
  }

  // A pre-allocated array is 3-4x faster then multiple push() calls
  const decimatedPolyline: Line = new Array(numDecimatedPoints);

  for (let srcIndex = 0, dstIndex = 0; srcIndex < numPoints; srcIndex++) {
    if (polylinePointFlags[srcIndex]) {
      decimatedPolyline[dstIndex++] = polyline[srcIndex];
    }
  }

  return decimatedPolyline;
}
