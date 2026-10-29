import { computed, ref, unref, watch, type MaybeRef } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { clampValue } from '@/src/utils';
import { getEnFaceUnavailableReason } from './availability';
import { useEnFaceViewStore } from './store';
import { deriveSlabGeometry } from '@/src/core/slab/geometry';
import { get2DOrientationForSourceAxis } from '@/src/utils/getViewingVectors';

export function useEnFaceInput(viewId: MaybeRef<string>) {
  const source = useCurrentImage();
  const { currentImageID, currentImageData, currentImageMetadata } = source;
  const enFaceStore = useEnFaceViewStore();
  const settings = computed(() =>
    enFaceStore.settingsFor(unref(viewId), currentImageID.value)
  );
  const volumeRevision = ref(0);
  const projectionReason = computed(() => {
    void volumeRevision.value;
    return getEnFaceUnavailableReason(currentImageID.value);
  });
  const dimensions = computed(() => {
    void volumeRevision.value;
    return currentImageData.value?.getDimensions() ?? [1, 1, 1];
  });
  const depthMaximum = computed(() =>
    Math.max(0, dimensions.value[settings.value.axis] - 1)
  );
  const orientation = computed(() =>
    get2DOrientationForSourceAxis(
      settings.value.axis,
      currentImageMetadata.value.lpsOrientation
    )
  );
  const axisOptions = computed(() =>
    (['Axial', 'Coronal', 'Sagittal'] as const).map((axis) => ({
      title: axis,
      value: currentImageMetadata.value.lpsOrientation[axis],
    }))
  );
  const depthStart = computed(() =>
    clampValue(settings.value.depthStart, 0, depthMaximum.value)
  );
  const depthEnd = computed(() =>
    clampValue(
      settings.value.depthEnd ?? depthMaximum.value,
      depthStart.value,
      depthMaximum.value
    )
  );
  watch(
    [
      settings,
      projectionReason,
      currentImageData,
      depthMaximum,
      () => settings.value.depthStart,
      () => settings.value.depthEnd,
    ],
    ([config, reason, image]) => {
      if (reason || !image) return;
      const start = depthStart.value;
      const end = config.depthEnd === null ? null : depthEnd.value;
      if (config.depthStart !== start) config.depthStart = start;
      if (config.depthEnd !== end) config.depthEnd = end;
    },
    { immediate: true, flush: 'sync' }
  );

  const volumeScalars = computed(() => {
    void volumeRevision.value;
    return currentImageData.value?.getPointData().getScalars();
  });
  onVTKEvent(currentImageData, 'onModified', () => {
    volumeRevision.value += 1;
  });
  onVTKEvent(volumeScalars, 'onModified', () => {
    volumeRevision.value += 1;
  });
  const specification = computed(() => ({
    axis: settings.value.axis,
    first: depthStart.value,
    last: depthEnd.value,
    method: settings.value.method,
  }));
  const geometry = computed(() => {
    void volumeRevision.value;
    const image = currentImageData.value;
    return image && !projectionReason.value
      ? deriveSlabGeometry(image, specification.value)
      : null;
  });
  const controls = computed(() => ({
    axes: axisOptions.value,
    depthMaximum: depthMaximum.value,
    projectionReason: projectionReason.value,
  }));
  return {
    source,
    orientation,
    controls,
    specification,
    geometry,
  };
}
