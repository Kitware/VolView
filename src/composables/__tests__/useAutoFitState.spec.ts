import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { effectScope, type EffectScope } from 'vue';
import vtkCamera from '@kitware/vtk.js/Rendering/Core/Camera';
import { useAutoFitState } from '@/src/composables/useAutoFitState';

describe('useAutoFitState', () => {
  // Each test runs the composable inside a disposable effect scope so the
  // onScopeDispose/watch machinery in onVTKEvent has a scope to attach to,
  // mirroring component setup.
  let scope: EffectScope;
  beforeEach(() => {
    scope = effectScope(true);
  });
  afterEach(() => scope.stop());
  const run = <T>(fn: () => T) => scope.run(fn)!;

  it('starts with auto-fit enabled', () => {
    const camera = vtkCamera.newInstance();
    const autoFit = run(() => useAutoFitState(camera));
    expect(autoFit.autoFit.value).toBe(true);
  });

  it('keeps auto-fit enabled through programmatic camera changes outside a pointer interaction', () => {
    const camera = vtkCamera.newInstance();
    const autoFit = run(() => useAutoFitState(camera));

    // Initial programmatic fit, as resetCamera() does on image load.
    autoFit.withPaused(() => {
      camera.setParallelScale(5);
    });
    expect(autoFit.autoFit.value).toBe(true);

    // A later non-user-driven camera change, e.g. resetCameraClippingRange()
    // fired from useVtkView.setSize() on a layout/resize. This must NOT
    // disable auto-fit, otherwise the next resize will not refit the slice.
    camera.modified();
    expect(autoFit.autoFit.value).toBe(true);
  });

  it('disables auto-fit when the user manipulates the camera during a pointer interaction', () => {
    const camera = vtkCamera.newInstance();
    const autoFit = run(() => useAutoFitState(camera));

    autoFit.resume(); // pointerdown
    camera.setParallelScale(42); // user zoom/pan modifies the camera
    autoFit.pause(); // pointerup

    expect(autoFit.autoFit.value).toBe(false);
  });
});
