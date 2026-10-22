import type { Vector3 } from '@kitware/vtk.js/types';
import {
  ColorTransferFunction,
  CVRConfig,
  BlendConfig,
  OpacityFunction,
} from '@/src/types/views';
import { WLAutoRanges } from '@/src/constants';

export type CameraConfig = {
  autoFit?: boolean;
  parallelScale?: number;
  position?: Vector3;
  focalPoint?: Vector3;
  directionOfProjection?: Vector3;
  viewUp?: Vector3;
  syncState?: boolean;
};

export interface SliceConfig {
  slice: number;
  min: number;
  max: number;
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
  preset?: string;
  visibility?: boolean;
  width?: number;
  level?: number;
  auto: keyof typeof WLAutoRanges; // User-selected percentile range
  useAuto?: boolean; // Whether to use the percentage histogram range
  userTriggered?: boolean; // Whether the user has changed the window/level
}

export type LayersConfig = {
  transferFunction: ColorTransferFunction;
  opacityFunction: OpacityFunction;
  blendConfig: BlendConfig;
  transparentBackground: boolean;
};

export type LayerDisplayConfig = ColorTransferFunction &
  Pick<BlendConfig, 'opacity' | 'visibility'> &
  Pick<LayersConfig, 'transparentBackground'>;

export interface CinePlaybackViewConfig {
  frame: number;
}
