import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import vtkLookupTableProxy from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import { vec3 } from 'gl-matrix';
import type { Vector3 } from '@kitware/vtk.js/types';
import vtkVolumeProperty from '@kitware/vtk.js/Rendering/Core/VolumeProperty';
import { getDiagonalLength } from '@kitware/vtk.js/Common/DataModel/BoundingBox';

export function createRenderingPipeline() {
  const actor = vtkVolume.newInstance();
  const mapper = vtkVolumeMapper.newInstance();
  const property = actor.getProperty();
  const cfun = vtkColorTransferFunction.newInstance();
  const ofun = vtkPiecewiseFunction.newInstance();
  property.setRGBTransferFunction(0, cfun);
  property.setScalarOpacity(0, ofun);
  actor.setMapper(mapper);
  return {
    actor,
    mapper,
    property,
    cfun,
    ofun,
  };
}

function updateRenderingProperty(
  prop: vtkVolumeProperty,
  mapper: vtkVolumeMapper,
  image: vtkImageData
) {
  const scalars = image.getPointData().getScalars();
  const dataRange = scalars.getRange();

  const sampleDistance =
    0.7 *
    Math.sqrt(
      image
        .getSpacing()
        .map((v) => v * v)
        .reduce((a, b) => a + b, 0)
    );
  mapper.setSampleDistance(sampleDistance * 2 ** (0.4 * 3.0 - 1.5));

  const diagonalLength = getDiagonalLength(image.getBounds()) ?? 1;
  prop.setScalarOpacityUnitDistance(
    0,
    diagonalLength / Math.max(...image.getDimensions())
  );
  prop.setGradientOpacityMinimumValue(0, 0);
  prop.setGradientOpacityMaximumValue(0, (dataRange[1] - dataRange[0]) * 0.05);
  // - Use shading based on gradient
  prop.setShade(true);
  prop.setUseGradientOpacity(0, true);
  // - generic good default
  prop.setGradientOpacityMinimumOpacity(0, 0.0);
  prop.setGradientOpacityMaximumOpacity(0, 1.0);
  prop.setAmbient(0.2);
  prop.setDiffuse(0.7);
  prop.setSpecular(0.3);
  prop.setSpecularPower(8.0);
}

export function createVolumeThumbnailer(size: number) {
  const container = document.createElement('div');
  container.style.width = `${size}px`;
  container.style.height = `${size}px`;

  const scene = vtkGenericRenderWindow.newInstance({
    listenWindowResize: false,
    background: [0.2, 0.3, 0.4],
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
        updateRenderingProperty(actor.getProperty(), mapper, image);
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
        const camera = renderer.getActiveCamera();
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
        renderer.resetCamera();
        // ensure correct lighting post camera manip
        renderer.updateLightsGeometryToFollowCamera();
      }
    },
  };
}
