import { Ruler } from './ruler';

type Tool = Ruler;
export type RectangleID = string & { __type: 'RectangleID' };
export type Rectangle = Omit<Tool, 'id'> & {
  id: RectangleID;
};

export type RectanglePatch = Partial<Omit<Rectangle, 'id'>>;
