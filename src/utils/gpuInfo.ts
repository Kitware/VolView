import { Maybe } from '@/src/types';

/**
 * Retrieves the GPU renderer and vendor info.
 * @returns
 */
export function getGPUInfo() {
  let canvas: Maybe<OffscreenCanvas | HTMLCanvasElement> = null;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(1, 1);
  } else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
  } else {
    throw new Error('Cannot init a canvas');
  }

  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
  if (!gl) {
    throw new Error('Cannot get a WebGL2 context');
  }

  const info = {
    renderer: '',
    vendor: '',
  };

  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  if (dbg) {
    info.renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
    info.vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
  } else {
    info.renderer = gl.getParameter(gl.RENDERER);
    info.vendor = gl.getParameter(gl.VENDOR);
  }

  return info;
}
