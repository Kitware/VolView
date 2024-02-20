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
import { vec3 } from 'gl-matrix';

/**
 * Sets the volume sampling distance.
 * @param mapper
 * @param distance A value betweeen 0 and 1.
 * @param imageData
 */
export function setSamplingDistance(
  mapper: vtkVolumeMapper,
  distance: number,
  imageData: vtkImageData
) {
  const sampleDistance =
    0.7 *
    Math.sqrt(
      imageData
        .getSpacing()
        .map((v) => v * v)
        .reduce((a, b) => a + b, 0)
    );
  mapper.setSampleDistance(sampleDistance * 2 ** (distance * 3.0 - 1.5));
}

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
      // eslint-disable-next-line no-continue
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
  quality: number;
  isAnimating: boolean;
  image: vtkImageData;
}

export function setCinematicVolumeSampling({
  enabled,
  mapper,
  quality,
  isAnimating,
  image,
}: SetCinematicVolumeSamplingParameters) {
  if (isAnimating) {
    mapper.setSampleDistance(0.75);
    mapper.setMaximumSamplesPerRay(1000);
    mapper.setGlobalIlluminationReach(0);
    mapper.setComputeNormalFromOpacity(false);
  } else {
    const dims = image.getDimensions();
    const spacing = image.getSpacing();
    const spatialDiagonal = vec3.length(
      vec3.fromValues(
        dims[0] * spacing[0],
        dims[1] * spacing[1],
        dims[2] * spacing[2]
      )
    );

    // Use the average spacing for sampling by default
    let sampleDistance = spacing.reduce((a, b) => a + b) / 3.0;
    // Adjust the volume sampling by the quality slider value
    sampleDistance /= quality > 1 ? 0.5 * quality ** 2 : 1.0;
    const samplesPerRay = spatialDiagonal / sampleDistance + 1;
    mapper.setMaximumSamplesPerRay(samplesPerRay);
    mapper.setSampleDistance(sampleDistance);
    // Adjust the global illumination reach by volume quality slider
    mapper.setGlobalIlluminationReach(enabled ? 0.25 * quality : 0);
    mapper.setComputeNormalFromOpacity(!enabled && quality > 2);
  }
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
  property.setScalarOpacityUnitDistance(
    0,
    (0.5 * getDiagonalLength(image.getBounds())) /
      Math.max(...image.getDimensions())
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
  mapper: vtkVolumeMapper;
  blending: number;
}

export function setCinematicVolumeScatter({
  enabled,
  mapper,
  blending,
}: SetCinematicVolumeScatterParameters) {
  (window as any).am = mapper;
  mapper.setVolumetricScatteringBlending(enabled ? blending : 0);
}

export interface SetCinematicLocalAmbientOcclusionParameters {
  enabled: boolean;
  mapper: vtkVolumeMapper;
  kernelSize: number;
  kernelRadius: number;
}

export function setCinematicLocalAmbientOcclusion({
  enabled,
  mapper,
  kernelSize,
  kernelRadius,
}: SetCinematicLocalAmbientOcclusionParameters) {
  if (enabled) {
    mapper.setLocalAmbientOcclusion(true);
    mapper.setLAOKernelSize(kernelSize);
    mapper.setLAOKernelRadius(kernelRadius);
  } else {
    mapper.setLocalAmbientOcclusion(false);
    mapper.setLAOKernelSize(0);
    mapper.setLAOKernelRadius(0);
  }
}
