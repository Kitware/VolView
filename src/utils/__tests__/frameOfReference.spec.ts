import chai, { expect } from 'chai';
import chaiAlmost from 'chai-almost';
import { vec3, mat3, mat4 } from 'gl-matrix';
import { ImageMetadata } from '@/src/types/image';
import {
  FrameOfReference,
  frameOfReferenceToImageSliceAndAxis,
} from '@/src/utils/frameOfReference';
import { getLPSDirections } from '../lps';

chai.use(chaiAlmost());

const TrivialMetadata: ImageMetadata = {
  name: '',
  orientation: mat3.create(),
  lpsOrientation: getLPSDirections(mat3.create()),
  spacing: vec3.fromValues(1, 1, 1),
  origin: vec3.create(),
  dimensions: vec3.fromValues(20, 20, 20),
  worldBounds: [0, 20, 0, 20, 0, 20],
  worldToIndex: mat4.create(),
  indexToWorld: mat4.create(),
};

describe('frameOfReferenceToImageSliceAndAxis', () => {
  it('should return an axis + slice', () => {
    const frame: FrameOfReference = {
      planeNormal: [1, 0, 0],
      planeOrigin: [10, 10, 10],
    };

    const result = frameOfReferenceToImageSliceAndAxis(frame, TrivialMetadata);
    expect(result).to.not.be.null;
    expect(result?.axis).to.equal('Sagittal');
    expect(result?.slice).to.equal(10);
  });

  it('should handle flipped planes', () => {
    const frame: FrameOfReference = {
      planeNormal: [-1, 0, 0],
      planeOrigin: [10, 10, 10],
    };

    const result = frameOfReferenceToImageSliceAndAxis(frame, TrivialMetadata);
    expect(result).to.not.be.null;
    expect(result?.axis).to.equal('Sagittal');
    expect(result?.slice).to.equal(10);
  });

  it('should detect out-of-bounds', () => {
    const frame: FrameOfReference = {
      planeNormal: [0, 1, 0],
      planeOrigin: [0, 100, 0],
    };

    const result = frameOfReferenceToImageSliceAndAxis(frame, TrivialMetadata);
    expect(result).to.be.null;

    const result2 = frameOfReferenceToImageSliceAndAxis(
      frame,
      TrivialMetadata,
      { allowOutOfBoundsSlice: true }
    );
    expect(result2).to.not.be.null;
    expect(result2?.axis).to.equal('Coronal');
    expect(result2?.slice).to.equal(100);
  });
});
