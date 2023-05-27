import { Ruler } from './ruler';

export type RectangleID = string & { __type: 'RectangleID' };
export type Rectangle = Omit<Ruler, 'id' | 'labelProps'> & {
  id: RectangleID;
  fillColor: string;
  labelProps: Array<keyof Rectangle>;
};
