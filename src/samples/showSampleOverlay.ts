import type { SampleDataset } from '@/src/types';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useViewStore } from '@/src/store/views';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { untilLoaded } from '@/src/composables/untilLoaded';

export async function showSampleOverlay(
  selections: string[],
  overlay: NonNullable<SampleDataset['overlay']>
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
  const views = useViewStore();
  views.setDataForAllViews(base);
  const slices = useViewSliceStore();
  views.viewIDs.forEach((viewID) => slices.resetSlice(viewID, base));
}
