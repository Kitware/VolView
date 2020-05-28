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
 * Adds all representations of a given source proxy.
 *
 * We call addRepresentation to handle the case where
 * the representation already exists, but doesn't exist in a view.
 * @param {vtkSourceProxy} source
 * @param {vtkProxyManager} proxyManager
 */
export function addRepresentationsOf(source, proxyManager) {
  const views = proxyManager.getViews();
  for (let i = 0; i < views.length; i += 1) {
    const view = views[i];
    const rep = proxyManager.getRepresentation(source, view);
    if (rep) {
      view.addRepresentation(rep);
    }
  }
}

/**
 * Removes all representations of a given source proxy.
 * @param {vtkSourceProxy} source
 * @param {vtkProxyManager} proxyManager
 */
export function removeRepresentationsOf(source, proxyManager) {
  const views = proxyManager.getViews();
  for (let i = 0; i < views.length; i += 1) {
    const view = views[i];
    const rep = proxyManager.getRepresentation(source, view);
    if (rep) {
      view.removeRepresentation(rep);
    }
  }
}

export function removeAllRepresentations(proxyManager) {
  const views = proxyManager.getViews();
  for (let i = 0; i < views.length; i += 1) {
    const view = views[i];
    const reps = view.getRepresentations();
    reps.forEach((r) => view.removeRepresentation(r));
  }
}

/**
 * If a proxy already has a representation, preserve it.
 */
export function renderProxies(proxyManager, proxies) {
  removeAllRepresentations(proxyManager);
  const views = proxyManager.getViews();
  for (let i = 0; i < views.length; i += 1) {
    const view = views[i];
    const reps = proxies.map((p) => proxyManager.getRepresentation(p, view));
    reps.forEach((r) => view.addRepresentation(r));
    view.renderLater();
  }
}

/**
 * Sets parallel scale of 2D view camera to fit a given bounds.
 *
 * Bounds is specified as width/height of orthographic view.
 * Renders must be triggered manually.
 */
export function resize2DCameraToFit(view, bounds) {
  const camera = view.getCamera();
  const [w, h] = view.getOpenglRenderWindow().getSize();
  const [bw, bh] = bounds;
  const viewAspect = w / h;
  const boundsAspect = bw / bh;

  let scale = 0;
  if (viewAspect >= boundsAspect) {
    scale = bh / 2;
  } else {
    scale = bw / 2 / viewAspect;
  }

  view.resetCamera();
  camera.setParallelScale(scale);
}
