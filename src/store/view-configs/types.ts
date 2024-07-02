import type { Vector3 } from '@kitware/vtk.js/types';
import { LPSAxisDir } from '@/src/types/lps';
import {
  ColorTransferFunction,
  CVRConfig,
  BlendConfig,
  OpacityFunction,
} from '@/src/types/views';
import { WLAutoRanges } from '@/src/constants';

export interface CameraConfig {
  parallelScale?: number;
  position?: Vector3;
  focalPoint?: Vector3;
  directionOfProjection?: Vector3;
  viewUp?: Vector3;
  syncState?: boolean;
}

export interface SliceConfig {
  slice: number;
  min: number;
  max: number;
  axisDirection: LPSAxisDir;
  syncState: boolean;
}

export interface VolumeColorConfig {
  colorBy: {
    arrayName: string;
    location: string;
  };
  transferFunction: ColorTransferFunction;
  opacityFunction: OpacityFunction;
  cvr: CVRConfig;
}

export interface WindowLevelConfig {
  width: number;
  level: number;
  min: number; // data range min
  max: number; // data range max
  auto: keyof typeof WLAutoRanges; // User-selected percentile range
  preset: {
    // User-selected preset value, if any
    width: number;
    level: number;
  };
}

export interface LayersConfig {
  colorBy: {
    arrayName: string;
    location: string;
  };
  transferFunction: ColorTransferFunction;
  opacityFunction: OpacityFunction;
  blendConfig: BlendConfig;
}
