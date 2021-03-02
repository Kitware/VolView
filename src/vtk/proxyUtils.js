export function createOrGetView(proxyManager, viewType, name) {
  const views = proxyManager.getViews();
  const view = views.find((v) => v.getName() === name);
  if (view) {
    return view;
  }

  return proxyManager.createProxy('Views', viewType, { name });
}

export function createFourUpViews(proxyManager) {
  createOrGetView(proxyManager, 'ViewX', 'X:1');
  createOrGetView(proxyManager, 'ViewY', 'Y:1');
  createOrGetView(proxyManager, 'ViewZ', 'Z:1');
  createOrGetView(proxyManager, 'View3D', '3D:1');
}

/**
 * Sets parallel scale of 2D view camera to fit a given bounds.
 *
 * Assumes the camera is reset, i.e. focused correctly.
 *
 * Bounds is specified as width/height of orthographic view.
 * Renders must be triggered manually.
 */
export function resize2DCameraToFit(view, axis, bounds) {
  const camera = view.getCamera();
  const lengths = [
    bounds[1] - bounds[0],
    bounds[3] - bounds[2],
    bounds[5] - bounds[4],
  ];
  const [w, h] = view.getOpenglRenderWindow().getSize();
  let bw;
  let bh;
  if (axis === 0 || axis === 2) {
    bw = lengths[(axis + 1) % 3];
    bh = lengths[(axis + 2) % 3];
  } else {
    bw = lengths[(axis + 2) % 3];
    bh = lengths[(axis + 1) % 3];
  }
  const viewAspect = w / h;
  const boundsAspect = bw / bh;

  let scale = 0;
  if (viewAspect >= boundsAspect) {
    scale = bh / 2;
  } else {
    scale = bw / 2 / viewAspect;
  }

  camera.setParallelScale(scale);
}
