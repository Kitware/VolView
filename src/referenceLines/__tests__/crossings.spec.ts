import { describe, it, expect } from 'vitest';
import {
  splitSegmentsAtCrossings,
  type ScreenSegment,
  type SegmentPiece,
} from '../crossings';

// A 16px gap leaves 8px of clear space either side of a crossing, matching the
// break the crosshairs overlay used to draw.
const GAP = 16;

const segment = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): ScreenSegment => ({ id, x1, y1, x2, y2 });

const piecesOf = (id: string, result: SegmentPiece[]) =>
  result.filter((piece) => piece.key.startsWith(`${id}:`));

/** Keys must match exactly; coordinates only to within rounding. */
function expectPieces(
  actual: SegmentPiece[],
  expected: Array<[string, number, number, number, number]>
) {
  expect(actual.map((piece) => piece.key)).toEqual(
    expected.map(([key]) => key)
  );
  actual.forEach((piece, index) => {
    const [, x1, y1, x2, y2] = expected[index];
    expect([piece.x1, piece.y1, piece.x2, piece.y2]).toAlmostEqual([
      x1,
      y1,
      x2,
      y2,
    ]);
  });
}

describe('splitSegmentsAtCrossings', () => {
  it('breaks both segments around a crossing', () => {
    const horizontal = segment('h', 0, 50, 100, 50);
    const vertical = segment('v', 50, 0, 50, 100);

    const pieces = splitSegmentsAtCrossings([horizontal, vertical], GAP);

    expectPieces(piecesOf('h', pieces), [
      ['h:0', 0, 50, 42, 50],
      ['h:1', 58, 50, 100, 50],
    ]);
    expectPieces(piecesOf('v', pieces), [
      ['v:0', 50, 0, 50, 42],
      ['v:1', 50, 58, 50, 100],
    ]);
  });

  it('leaves non-crossing segments whole', () => {
    const first = segment('a', 0, 10, 100, 10);
    const second = segment('b', 0, 90, 100, 90);

    const pieces = splitSegmentsAtCrossings([first, second], GAP);

    expectPieces(pieces, [
      ['a:0', 0, 10, 100, 10],
      ['b:0', 0, 90, 100, 90],
    ]);
  });

  it('ignores crossings that lie beyond either segment', () => {
    // These would meet at (50, 50) if both were extended.
    const horizontal = segment('h', 0, 50, 40, 50);
    const vertical = segment('v', 50, 0, 50, 40);

    const pieces = splitSegmentsAtCrossings([horizontal, vertical], GAP);

    expectPieces(pieces, [
      ['h:0', 0, 50, 40, 50],
      ['v:0', 50, 0, 50, 40],
    ]);
  });

  it('gaps a segment once per crossing when several lines cross it', () => {
    const vertical = segment('v', 50, 0, 50, 100);
    const lower = segment('h1', 0, 20, 100, 20);
    const upper = segment('h2', 0, 80, 100, 80);

    const pieces = splitSegmentsAtCrossings([vertical, lower, upper], GAP);

    expectPieces(piecesOf('v', pieces), [
      ['v:0', 50, 0, 50, 12],
      ['v:1', 50, 28, 50, 72],
      ['v:2', 50, 88, 50, 100],
    ]);
    // The two parallel peers each keep a single gap.
    expect(piecesOf('h1', pieces)).toHaveLength(2);
    expect(piecesOf('h2', pieces)).toHaveLength(2);
  });

  it('merges gaps from crossings closer together than the gap width', () => {
    const vertical = segment('v', 50, 0, 50, 100);
    const first = segment('h1', 0, 48, 100, 48);
    const second = segment('h2', 0, 52, 100, 52);

    const pieces = splitSegmentsAtCrossings([vertical, first, second], GAP);

    expectPieces(piecesOf('v', pieces), [
      ['v:0', 50, 0, 50, 40],
      ['v:1', 50, 60, 50, 100],
    ]);
  });

  it('drops the stub when a crossing sits within a gap of the segment end', () => {
    const horizontal = segment('h', 0, 50, 100, 50);
    const vertical = segment('v', 4, 0, 4, 100);

    const pieces = splitSegmentsAtCrossings([horizontal, vertical], GAP);

    expectPieces(piecesOf('h', pieces), [['h:0', 12, 50, 100, 50]]);
  });

  it('drops a segment shorter than its gap', () => {
    const short = segment('short', 48, 50, 52, 50);
    const vertical = segment('v', 50, 0, 50, 100);

    const pieces = splitSegmentsAtCrossings([short, vertical], GAP);

    expect(piecesOf('short', pieces)).toEqual([]);
    expect(piecesOf('v', pieces)).toHaveLength(2);
  });

  it('drops degenerate segments', () => {
    const point = segment('p', 50, 50, 50, 50);

    expect(splitSegmentsAtCrossings([point], GAP)).toEqual([]);
  });

  it('returns a lone segment untouched', () => {
    const only = segment('only', 0, 0, 100, 100);

    expectPieces(splitSegmentsAtCrossings([only], GAP), [
      ['only:0', 0, 0, 100, 100],
    ]);
  });
});
