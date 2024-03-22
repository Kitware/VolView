import { Component } from 'vue';
import MultiObliqueSliceViewer from '@/src/components/MultiObliqueSliceViewer.vue';
import ObliqueSliceViewer from '@/src/components/ObliqueSliceViewer.vue';
import SliceViewer from '@/src/components/SliceViewer.vue';
import VolumeViewer from '@/src/components/VolumeViewer.vue';

export const ViewTypeToComponent: Record<string, Component> = {
  '2D': SliceViewer,
  '3D': VolumeViewer,
  Oblique: ObliqueSliceViewer,
  Oblique3D: MultiObliqueSliceViewer,
};
