/* eslint-disable max-classes-per-file */
import { computed, effectScope, ref, Ref } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { ImageMetadata } from '@/src/types/image';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { mat3, mat4, vec3 } from 'gl-matrix';
import { defaultLPSDirections, getLPSDirections } from '@/src/utils/lps';
import { Bounds } from '@kitware/vtk.js/types';
import { watchImmediate } from '@vueuse/core';
import { NO_NAME } from '@/src/constants';

export type ProgressiveImageStatus = 'complete' | 'incomplete';

export type ProgressiveImageEvents = {
  status: ProgressiveImageStatus;
  loading: boolean;
  error: Error;
};

export interface ProgressiveImage {
  /**
   * A new vtkImageData may be returned at any time while this image is incomplete.
   */
  getVtkImageData(): vtkImageData;
  getImageMetadata(): ImageMetadata;
  startLoad(): void;
  stopLoad(): void;
  getStatus(): ProgressiveImageStatus;
  isLoading(): boolean;
  isLoaded(): boolean;
  addEventListener<T extends keyof ProgressiveImageEvents>(
    type: T,
    callback: (info: ProgressiveImageEvents[T]) => void
  ): void;
  removeEventListener<T extends keyof ProgressiveImageEvents>(
    type: T,
    callback: (info: ProgressiveImageEvents[T]) => void
  ): void;
  dispose(): void;
  getName(): string;
  setName(name: string): void;

  loading: Ref<boolean>;
  loaded: Ref<boolean>;
  status: Ref<ProgressiveImageStatus>;
  vtkImageData: Ref<vtkImageData>;
  imageMetadata: Ref<ImageMetadata>;
  name: Ref<string>;
}

export const defaultImageMetadata = (): ImageMetadata => ({
  name: NO_NAME,
  orientation: mat3.create(),
  lpsOrientation: defaultLPSDirections(),
  spacing: vec3.fromValues(1, 1, 1),
  origin: vec3.create(),
  dimensions: vec3.fromValues(1, 1, 1),
  worldBounds: [0, 1, 0, 1, 0, 1] as Bounds,
  worldToIndex: mat4.create(),
  indexToWorld: mat4.create(),
});

function metadataFromVtkImageData(
  imageData: vtkImageData
): Omit<ImageMetadata, 'name'> {
  return {
    dimensions: imageData.getDimensions() as vec3,
    spacing: imageData.getSpacing() as vec3,
    origin: imageData.getOrigin() as vec3,
    orientation: imageData.getDirection(),
    lpsOrientation: getLPSDirections(imageData.getDirection()),
    worldBounds: imageData.getBounds(),
    worldToIndex: imageData.getWorldToIndex(),
    indexToWorld: imageData.getIndexToWorld(),
  };
}

export function reactiveVtkImageMetadata(
  imageData: Ref<vtkImageData>,
  name: Ref<string>
) {
  const vtkMetadata: Ref<Omit<ImageMetadata, 'name'>> = ref(
    defaultImageMetadata()
  );

  const scope = effectScope();
  scope.run(() => {
    onVTKEvent(imageData, 'onModified', () => {});

    watchImmediate(imageData, () => {
      vtkMetadata.value = metadataFromVtkImageData(imageData.value);
    });
  });

  return {
    imageMetadata: computed(() => {
      return {
        ...vtkMetadata.value,
        name: name.value,
      };
    }),
    stop: () => scope.stop(),
  };
}

export abstract class BaseProgressiveImage implements ProgressiveImage {
  public loading: Ref<boolean>;
  public loaded: Ref<boolean>;
  public status: Ref<ProgressiveImageStatus>;
  public vtkImageData: Ref<vtkImageData>;
  public imageMetadata: Ref<ImageMetadata>;
  public name: Ref<string>;
  private cleanupListeners: () => void;

  constructor() {
    this.loading = ref(false);
    this.loaded = ref(false);
    this.status = ref('incomplete');
    this.vtkImageData = ref(vtkImageData.newInstance());
    this.imageMetadata = ref(defaultImageMetadata());
    this.name = ref(NO_NAME);

    const { imageMetadata, stop } = reactiveVtkImageMetadata(
      this.vtkImageData,
      this.name
    );
    this.imageMetadata = imageMetadata;

    this.cleanupListeners = () => {
      stop();
    };
  }

  getVtkImageData(): vtkImageData {
    return this.vtkImageData.value;
  }

  getImageMetadata(): ImageMetadata {
    return this.imageMetadata.value;
  }

  getStatus(): ProgressiveImageStatus {
    return this.status.value;
  }

  isLoading(): boolean {
    return this.loading.value;
  }

  isLoaded(): boolean {
    return this.loaded.value;
  }

  getName(): string {
    return this.name.value;
  }

  setName(name: string): void {
    this.name.value = name;
  }

  dispose() {
    this.cleanupListeners();
  }

  abstract startLoad(): void;

  abstract stopLoad(): void;

  abstract addEventListener<T extends keyof ProgressiveImageEvents>(
    type: T,
    callback: (info: ProgressiveImageEvents[T]) => void
  ): void;

  abstract removeEventListener<T extends keyof ProgressiveImageEvents>(
    type: T,
    callback: (info: ProgressiveImageEvents[T]) => void
  ): void;
}

export class LoadedVtkImage extends BaseProgressiveImage {
  constructor(data: vtkImageData, name: string) {
    super();

    this.loaded.value = true;
    this.status.value = 'complete';
    this.vtkImageData.value = data;
    this.name.value = name;
  }

  dispose() {
    super.dispose();
    this.vtkImageData.value.delete();
  }

  /* eslint-disable class-methods-use-this */

  startLoad(): void {
    // noop
  }

  stopLoad(): void {
    // noop
  }

  addEventListener(): void {
    // noop
  }

  removeEventListener(): void {
    // noop
  }
}
