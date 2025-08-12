import { Component } from 'vue';
// import MultiObliqueSliceViewer from '@/src/components/MultiObliqueSliceViewer.vue';
// import ObliqueSliceViewer from '@/src/components/ObliqueSliceViewer.vue';
import SliceViewer from '@/src/components/SliceViewer.vue';
import VolumeViewer from '@/src/components/VolumeViewer.vue';
import { ViewInfo } from '@/src/types/views';
import { Maybe } from '@/src/types';

export function getComponentFromViewInfo(info: ViewInfo): Maybe<Component> {
  switch (info.type) {
    case '2D':
      return SliceViewer;
    case '3D':
      return VolumeViewer;
    // case 'Oblique':
    //
    default:
      return null;
  }
}
