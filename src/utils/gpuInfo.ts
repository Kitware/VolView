function getContextFromOffscreenCanvas() {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const canvas = new OffscreenCanvas(1, 1);
  return canvas.getContext('webgl2') as WebGL2RenderingContext | null;
}

function getContextFromHTMLCanvas() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  return canvas.getContext('webgl2') as WebGL2RenderingContext | null;
}

/**
 * Retrieves the GPU renderer and vendor info.
 * @returns
 */
export function getGPUInfo() {
  // try offscreencanvas to support usage in webworkers
  const gl = getContextFromOffscreenCanvas() ?? getContextFromHTMLCanvas();
  if (!gl) {
    throw new Error('Cannot get a webgl2 context');
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
