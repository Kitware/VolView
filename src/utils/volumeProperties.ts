import {
  DEFAULT_AMBIENT,
  DEFAULT_DIFFUSE,
  DEFAULT_SPECULAR,
} from '@/src/store/view-configs/volume-coloring';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { getDiagonalLength } from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkVolumeProperty from '@kitware/vtk.js/Rendering/Core/VolumeProperty';
import { Vector3 } from '@kitware/vtk.js/types';

/**
 * Sets the edge gradient.
 * @param property
 * @param edgeGradient A value between 0 and 1.
 * @param dataArray
 */
export function setEdgeGradient(
  property: vtkVolumeProperty,
  edgeGradient: number,
  dataArray: vtkDataArray
) {
  const numberOfComponents = dataArray.getNumberOfComponents();
  for (let component = 0; component < numberOfComponents; component++) {
    if (edgeGradient === 0) {
      property.setUseGradientOpacity(component, false);

      continue;
    }

    property.setUseGradientOpacity(component, true);

    const range = dataArray.getRange(component);
    const width = range[1] - range[0];
    const minV = Math.max(0.0, edgeGradient - 0.3) / 0.7;
    const minGradOpacity =
      minV > 0 ? Math.exp(Math.log(width * 0.2) * minV ** 2) : 0;
    const maxGradOpacity = Math.exp(Math.log(width * edgeGradient ** 2));

    property.setGradientOpacityMinimumValue(component, minGradOpacity);
    property.setGradientOpacityMaximumValue(component, maxGradOpacity);
  }
}

export interface SetCinematicLightingParameters {
  renderer: vtkRenderer;
  enabled: boolean;
  center: Vector3;
  lightFollowsCamera: boolean;
}

export function setCinematicLighting({
  renderer,
  enabled,
  center,
  lightFollowsCamera,
}: SetCinematicLightingParameters) {
  if (renderer.getLights().length === 0) {
    renderer.createLight();
  }
  const light = renderer.getLights()[0];
  if (enabled) {
    light.setFocalPoint(...center);
    light.setColor(1, 1, 1);
    light.setIntensity(1);
    light.setConeAngle(90);
    light.setPositional(true);
    renderer.setTwoSidedLighting(false);
    if (lightFollowsCamera) {
      light.setLightTypeToHeadLight();
      renderer.updateLightsGeometryToFollowCamera();
    } else {
      light.setLightTypeToSceneLight();
    }
  } else {
    light.setPositional(false);
  }
}

export interface SetCinematicVolumeSamplingParameters {
  enabled: boolean;
  mapper: vtkVolumeMapper;
  property: vtkVolumeProperty;
  quality: number;
  image: vtkImageData;
}

export function setCinematicVolumeSampling({
  enabled,
  mapper,
  property,
  quality,
  image,
}: SetCinematicVolumeSamplingParameters) {
  const spacing = image.getSpacing();
  const spatialDiagonal = getDiagonalLength(image.getBounds()) ?? 0;

  // Use the average spacing for sampling by default
  let sampleDistance = spacing.reduce((a, b) => a + b) / 3.0;
  // Adjust the volume sampling by the quality slider value
  sampleDistance /= quality > 1 ? 0.5 * quality ** 2 : 1.0;
  const samplesPerRay = spatialDiagonal / sampleDistance + 1;
  mapper.setMaximumSamplesPerRay(samplesPerRay);
  mapper.setSampleDistance(sampleDistance);
  // Adjust the global illumination reach by volume quality slider
  property.setGlobalIlluminationReach(enabled ? 0.25 * quality : 0);
  property.setComputeNormalFromOpacity(!enabled && quality > 2);
}

export interface SetCinematicVolumeShadingParameters {
  enabled: boolean;
  image: vtkImageData;
  property: vtkVolumeProperty;
  ambient: number;
  diffuse: number;
  specular: number;
  component?: number;
}

export function setCinematicVolumeShading({
  enabled,
  image,
  property,
  ambient,
  diffuse,
  specular,
  component = 0,
}: SetCinematicVolumeShadingParameters) {
  const diagonalLength = getDiagonalLength(image.getBounds()) ?? 1;
  property.setScalarOpacityUnitDistance(
    0,
    (0.5 * diagonalLength) / Math.max(...image.getDimensions())
  );

  property.setShade(true);
  property.setUseGradientOpacity(component, !enabled);
  property.setGradientOpacityMinimumValue(component, 0.0);
  const dataRange = image.getPointData().getScalars().getRange();
  property.setGradientOpacityMaximumValue(
    component,
    (dataRange[1] - dataRange[0]) * 0.01
  );
  property.setGradientOpacityMinimumOpacity(component, 0.0);
  property.setGradientOpacityMaximumOpacity(component, 1.0);

  // do not toggle these parameters when animating
  property.setAmbient(enabled ? ambient : DEFAULT_AMBIENT);
  property.setDiffuse(enabled ? diffuse : DEFAULT_DIFFUSE);
  property.setSpecular(enabled ? specular : DEFAULT_SPECULAR);
}

export interface SetCinematicVolumeScatterParameters {
  enabled: boolean;
  property: vtkVolumeProperty;
  blending: number;
}

export function setCinematicVolumeScatter({
  enabled,
  property,
  blending,
}: SetCinematicVolumeScatterParameters) {
  property.setVolumetricScatteringBlending(enabled ? blending : 0);
}

export interface SetCinematicLocalAmbientOcclusionParameters {
  enabled: boolean;
  property: vtkVolumeProperty;
  kernelSize: number;
  kernelRadius: number;
}

export function setCinematicLocalAmbientOcclusion({
  enabled,
  property,
  kernelSize,
  kernelRadius,
}: SetCinematicLocalAmbientOcclusionParameters) {
  if (enabled) {
    property.setLocalAmbientOcclusion(true);
    property.setLAOKernelSize(kernelSize);
    property.setLAOKernelRadius(kernelRadius);
  } else {
    property.setLocalAmbientOcclusion(false);
    property.setLAOKernelSize(0);
    property.setLAOKernelRadius(0);
  }
}
