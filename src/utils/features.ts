import { getGPUInfo } from '@/src/utils/gpuInfo';

function isWebGlUsingAngle() {
  try {
    const info = getGPUInfo();
    return info.renderer.startsWith('ANGLE');
  } catch (_) {
    return false;
  }
}

export const IS_WEBGL_USING_ANGLE = isWebGlUsingAngle();
