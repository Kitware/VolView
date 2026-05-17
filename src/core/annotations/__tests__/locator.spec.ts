import { describe, it, expect } from 'vitest';
import { locatorMatches, type Locator } from '@/src/core/annotations/locator';
import type { AnnotationTool } from '@/src/types/annotation-tool';
import { AXIAL_FRAME_OF_REFERENCE } from '@/src/utils/frameOfReference';

const baseTool = {
  id: 'tool-1' as AnnotationTool['id'],
  imageID: 'img-1',
  name: 'tool',
  color: '#fff',
  frameOfReference: AXIAL_FRAME_OF_REFERENCE,
};

const spatialTool: AnnotationTool = {
  ...baseTool,
  slice: 5,
};
const temporalTool: AnnotationTool = {
  ...baseTool,
  slice: 0,
  frame: 3,
};

const spatialHere: Locator = {
  kind: 'spatial',
  slice: 5,
  axis: 'Axial',
  frameOfReference: spatialTool.frameOfReference,
};
const temporalHere: Locator = { kind: 'temporal', frame: 3 };

describe('locatorMatches', () => {
  it('matches spatial tool on the same slice', () => {
    expect(locatorMatches(spatialTool, spatialHere)).toBe(true);
  });

  it('does not match spatial tool on a different slice', () => {
    expect(locatorMatches(spatialTool, { ...spatialHere, slice: 6 })).toBe(
      false
    );
  });

  it('matches temporal tool on the same frame', () => {
    expect(locatorMatches(temporalTool, temporalHere)).toBe(true);
  });

  it('does not match temporal tool on a different frame', () => {
    expect(locatorMatches(temporalTool, { kind: 'temporal', frame: 4 })).toBe(
      false
    );
  });

  it('returns false for the none locator', () => {
    expect(locatorMatches(spatialTool, { kind: 'none' })).toBe(false);
    expect(locatorMatches(temporalTool, { kind: 'none' })).toBe(false);
  });
});
