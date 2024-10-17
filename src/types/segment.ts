import { RGBAColor } from '@kitware/vtk.js/types';

export interface SegmentMask {
  value: number;
  name: string;
  color: RGBAColor;
  visible: boolean;
}
