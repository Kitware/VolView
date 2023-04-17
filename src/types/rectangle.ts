import { PartialWithRequired } from '.';
import { Ruler } from './ruler';

type Tool = Ruler;
interface PlacingTool extends PartialWithRequired<Tool, 'id' | 'color'> {}

export type RectangleID = string & { __type: 'RectangleID' };

export type Rectangle = Omit<Tool, 'id'> & {
  id: RectangleID;
};

export type RectanglePatch = Partial<Omit<Rectangle, 'id'>>;

export type PlacingRectangle = PlacingTool;
