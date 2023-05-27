import { Ruler } from './ruler';

export type RectangleID = string & { __type: 'RectangleID' };
export type Rectangle = Omit<Ruler, 'id'> & {
  id: RectangleID;
  fillColor: string;
};
