import { RGBAColor } from '@kitware/vtk.js/types';

export interface LabelMapSegment {
  value: number;
  name: string;
  color: RGBAColor;
}
