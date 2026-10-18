import type { SampleDataset } from '@/src/types';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useLayerColoringStore } from '@/src/store/view-configs/layers';
import { useViewStore } from '@/src/store/views';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { untilLoaded } from '@/src/composables/untilLoaded';

export async function applySampleDefaults(
  selections: string[],
  overlay: NonNullable<NonNullable<SampleDataset['defaults']>['overlay']>
) {
  const dicomStore = useDICOMStore();
  const byModality = (modality: string) =>
    selections.find((id) => dicomStore.volumeInfo[id]?.Modality === modality);
  const base = byModality(overlay.baseModality);
  const source = byModality(overlay.modality);
  if (!base || !source)
    throw new Error('Sample is missing a required modality');
  await Promise.all([untilLoaded(base), untilLoaded(source)]);
  const layerID = await useLayersStore().addLayer(base, source);
  if (!layerID) throw new Error('Sample overlay could not be loaded');
  useLayerColoringStore().updateDisplayConfig(layerID, {
    preset: overlay.preset,
    mappingRange: overlay.mappingRange,
    opacity: overlay.opacity,
    transparentBackground: overlay.transparentBackground,
  });
  const views = useViewStore();
  views.setDataForAllViews(base);
  views.viewIDs.forEach((viewID) => {
    const slices = useViewSliceStore();
    const { min, max } = slices.getConfig(viewID, base);
    slices.updateConfig(viewID, base, { slice: Math.ceil((min + max) / 2) });
  });
}
