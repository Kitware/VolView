import { describe, it, expect } from 'vitest';
import { mat3, mat4, vec3 } from 'gl-matrix';
import type { Vector3 } from '@kitware/vtk.js/types';
import type { ImageMetadata } from '@/src/types/image';
import type { LPSDirections } from '@/src/types/lps';
import {
  computeReferenceLine,
  slicePlane,
  type ReferenceLine,
} from '../geometry';

// --- fixtures ---------------------------------------------------------

const IDENTITY_LPS: LPSDirections = {
  Left: vec3.fromValues(1, 0, 0),
  Right: vec3.fromValues(-1, 0, 0),
  Posterior: vec3.fromValues(0, 1, 0),
  Anterior: vec3.fromValues(0, -1, 0),
  Superior: vec3.fromValues(0, 0, 1),
  Inferior: vec3.fromValues(0, 0, -1),
  Sagittal: 0,
  Coronal: 1,
  Axial: 2,
};

/**
 * Builds ImageMetadata from a direction matrix (columns = world direction of
 * each ijk axis), spacing and origin. Only the fields the geometry reads are
 * meaningful.
 */
function makeMetadata({
  dimensions = [10, 20, 30] as Vector3,
  spacing = [1, 1, 1] as Vector3,
  origin = [0, 0, 0] as Vector3,
  direction = mat3.create(),
  lpsOrientation = IDENTITY_LPS,
}: {
  dimensions?: Vector3;
  spacing?: Vector3;
  origin?: Vector3;
  direction?: mat3;
  lpsOrientation?: LPSDirections;
} = {}): ImageMetadata {
  const indexToWorld = mat4.create();
  // column-major: column i is the world vector of one index step along i
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      indexToWorld[col * 4 + row] = direction[col * 3 + row] * spacing[col];
    }
  }
  indexToWorld[12] = origin[0];
  indexToWorld[13] = origin[1];
  indexToWorld[14] = origin[2];

  const worldToIndex = mat4.create();
  mat4.invert(worldToIndex, indexToWorld);

  return {
    name: 'test',
    orientation: direction,
    lpsOrientation,
    spacing,
    origin,
    dimensions,
    worldBounds: [0, 0, 0, 0, 0, 0],
    worldToIndex,
    indexToWorld,
  };
}

/** Endpoints come back in an arbitrary order; compare as an unordered pair. */
function expectSegment(
  line: ReferenceLine | null,
  a: Vector3,
  b: Vector3
): void {
  expect(line).not.toBeNull();
  const { p1, p2 } = line!;
  const forward = vec3.distance(p1, a) < 1e-6 && vec3.distance(p2, b) < 1e-6;
  const backward = vec3.distance(p1, b) < 1e-6 && vec3.distance(p2, a) < 1e-6;
  expect(
    forward || backward,
    `expected segment ${JSON.stringify([a, b])}, got ${JSON.stringify([
      p1,
      p2,
    ])}`
  ).toBe(true);
}

// --- slicePlane -------------------------------------------------------

describe('slicePlane', () => {
  it('builds a unit-normal plane at the slice for an identity image', () => {
    const metadata = makeMetadata();
    const plane = slicePlane('Axial', 7, metadata);

    expect(Array.from(plane.normal)).toAlmostEqual([0, 0, 1]);
    // the plane passes through world z = 7
    expect(vec3.dot(plane.normal, plane.origin)).toAlmostEqual(7);
  });

  it('accounts for spacing and a non-identity direction matrix', () => {
    // 90 degree rotation about z: index i -> world +y, index j -> world -x
    const direction = mat3.fromValues(0, 1, 0, -1, 0, 0, 0, 0, 1);
    const metadata = makeMetadata({
      spacing: [2, 3, 4],
      origin: [5, -5, 10],
      direction,
    });

    const plane = slicePlane('Axial', 3, metadata);

    // Axial is ijk index 2 -> world +z, spacing 4, origin z 10
    expect(Array.from(plane.normal)).toAlmostEqual([0, 0, 1]);
    expect(vec3.dot(plane.normal, plane.origin)).toAlmostEqual(10 + 3 * 4);

    const sagittal = slicePlane('Sagittal', 2, metadata);
    // Sagittal is ijk index 0 -> world +y under this rotation
    expect(Array.from(sagittal.normal)).toAlmostEqual([0, 1, 0]);
    expect(vec3.dot(sagittal.normal, sagittal.origin)).toAlmostEqual(
      -5 + 2 * 2
    );
  });
});

// --- computeReferenceLine ---------------------------------------------

describe('computeReferenceLine', () => {
  const metadata = makeMetadata({ dimensions: [10, 20, 30] });

  it('returns the clipped intersection of an axial host and a sagittal peer', () => {
    const host = slicePlane('Axial', 5, metadata);
    const peer = slicePlane('Sagittal', 3, metadata);

    const line = computeReferenceLine(host, peer, metadata);

    // constant x = 3, constant z = 5, spanning the inflated j extent
    expectSegment(line, [3, -0.5, 5], [3, 19.5, 5]);
  });

  it('returns the clipped intersection of a coronal host and an axial peer', () => {
    const host = slicePlane('Coronal', 8, metadata);
    const peer = slicePlane('Axial', 12, metadata);

    const line = computeReferenceLine(host, peer, metadata);

    expectSegment(line, [-0.5, 8, 12], [9.5, 8, 12]);
  });

  it('returns null for parallel planes (same axis peers)', () => {
    const host = slicePlane('Axial', 5, metadata);
    const peer = slicePlane('Axial', 17, metadata);

    expect(computeReferenceLine(host, peer, metadata)).toBeNull();
  });

  it('returns null for coincident planes', () => {
    const host = slicePlane('Sagittal', 4, metadata);
    const peer = slicePlane('Sagittal', 4, metadata);

    expect(computeReferenceLine(host, peer, metadata)).toBeNull();
  });

  it('returns null for near-parallel planes', () => {
    const host = slicePlane('Axial', 5, metadata);
    const tilt = 1e-9;
    const peer = {
      origin: [0, 0, 10] as Vector3,
      normal: vec3.normalize(
        vec3.create(),
        vec3.fromValues(tilt, 0, 1)
      ) as unknown as Vector3,
    };

    expect(computeReferenceLine(host, peer, metadata)).toBeNull();
  });

  it('returns null when the intersection line misses the image box', () => {
    // sagittal plane well outside the i extent
    const host = slicePlane('Axial', 5, metadata);
    const peer = {
      origin: [1000, 0, 0] as Vector3,
      normal: [1, 0, 0] as Vector3,
    };

    expect(computeReferenceLine(host, peer, metadata)).toBeNull();
  });

  it('returns null when the host slice itself is outside the image box', () => {
    const host = slicePlane('Axial', 500, metadata);
    const peer = slicePlane('Sagittal', 3, metadata);

    expect(computeReferenceLine(host, peer, metadata)).toBeNull();
  });

  it('clips an oblique peer plane against the box', () => {
    // 45 degree plane through the volume: x + z = 10, i.e. normal (1,0,1)/sqrt2
    const host = slicePlane('Coronal', 6, metadata);
    const peer = {
      origin: [10, 0, 0] as Vector3,
      normal: vec3.normalize(
        vec3.create(),
        vec3.fromValues(1, 0, 1)
      ) as unknown as Vector3,
    };

    const line = computeReferenceLine(host, peer, metadata);

    // Line: y = 6, x + z = 10. Clipped by x in [-0.5, 9.5] and z in [-0.5, 29.5].
    // x = -0.5 -> z = 10.5 (in range); x = 9.5 -> z = 0.5 (in range).
    expectSegment(line, [-0.5, 6, 10.5], [9.5, 6, 0.5]);
  });

  it('clips in index space for a non-identity direction matrix', () => {
    // 90 degree rotation about z with anisotropic spacing
    const direction = mat3.fromValues(0, 1, 0, -1, 0, 0, 0, 0, 1);
    const rotated = makeMetadata({
      dimensions: [10, 20, 30],
      spacing: [2, 1, 1],
      direction,
    });

    const host = slicePlane('Axial', 5, rotated);
    const peer = slicePlane('Sagittal', 3, rotated);

    // Sagittal (ijk 0) runs along world +y with spacing 2 -> y = 6.
    // The free axis is ijk 1, which runs along world -x with spacing 1,
    // clipped to index [-0.5, 19.5] -> world x in [-19.5, 0.5].
    const line = computeReferenceLine(host, peer, rotated);

    expectSegment(line, [0.5, 6, 5], [-19.5, 6, 5]);
  });
});
