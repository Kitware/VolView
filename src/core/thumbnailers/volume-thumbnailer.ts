import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import vtkLookupTableProxy from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import { vec3 } from 'gl-matrix';
import { Vector3 } from '@kitware/vtk.js/types';

export function createRenderingPipeline() {
  const actor = vtkVolume.newInstance();
  const mapper = vtkVolumeMapper.newInstance();
  const property = actor.getProperty();
  const cfun = vtkColorTransferFunction.newInstance();
  const ofun = vtkPiecewiseFunction.newInstance();
  property.setRGBTransferFunction(0, cfun);
  property.setScalarOpacity(0, ofun);
  property.setUseGradientOpacity(0, true);
  property.setScalarOpacityUnitDistance(0, 3);
  property.setInterpolationTypeToLinear();
  property.setGradientOpacityMinimumValue(0, 2);
  property.setGradientOpacityMaximumValue(0, 20);
  property.setGradientOpacityMinimumOpacity(0, 0);
  property.setGradientOpacityMaximumOpacity(0, 1);
  mapper.setSampleDistance(1);
  actor.setMapper(mapper);
  return {
    actor,
    mapper,
    property,
    cfun,
    ofun,
  };
}

export function createVolumeThumbnailer(size: number) {
  const container = document.createElement('div');
  container.style.width = `${size}px`;
  container.style.height = `${size}px`;

  const scene = vtkGenericRenderWindow.newInstance({
    listenWindowResize: false,
  });
  scene.setContainer(container);

  const pipeline = createRenderingPipeline();
  const { actor, mapper } = pipeline;
  const renderer = scene.getRenderer();

  // wrap with proxies for easier usage
  const opacityFuncProxy = vtkPiecewiseFunctionProxy.newInstance({
    piecewiseFunction: pipeline.ofun,
  });
  const colorTransferFuncProxy = vtkLookupTableProxy.newInstance({
    lookupTable: pipeline.cfun,
  });

  return {
    scene,
    pipeline,
    opacityFuncProxy,
    colorTransferFuncProxy,
    setInputImage(image: vtkImageData | null) {
      if (image) {
        mapper.setInputData(image);
        if (!renderer.hasViewProp(actor)) {
          renderer.addVolume(actor);
        }
      } else {
        renderer.removeVolume(actor);
      }
    },
    resetCameraWithOrientation(direction: Vector3, up: Vector3) {
      const image = mapper.getInputData() as vtkImageData | null;
      if (image) {
        const ren = scene.getRenderer();
        const camera = ren.getActiveCamera();
        const bounds = image.getBounds();
        const center = [
          (bounds[0] + bounds[1]) / 2,
          (bounds[2] + bounds[3]) / 2,
          (bounds[4] + bounds[5]) / 2,
        ] as Vector3;

        const position = vec3.clone(center) as Vector3;
        vec3.sub(position, position, direction);
        camera.setFocalPoint(...center);
        camera.setPosition(...position);
        camera.setDirectionOfProjection(...direction);
        camera.setViewUp(...up);
        ren.resetCamera();
      }
    },
  };
}
