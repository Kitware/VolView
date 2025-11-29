import SliceViewer from '@/src/components/SliceViewer.vue';
import VolumeViewer from '@/src/components/VolumeViewer.vue';
import { ViewInfo } from '@/src/types/views';
import { Maybe } from '@/src/types';
import ObliqueViewer from '@/src/components/ObliqueViewer.vue';

type ViewComponent =
  | typeof SliceViewer
  | typeof VolumeViewer
  | typeof ObliqueViewer;

export function getComponentFromViewInfo(info: ViewInfo): Maybe<ViewComponent> {
  switch (info.type) {
    case '2D':
      return SliceViewer;
    case '3D':
      return VolumeViewer;
    case 'Oblique':
      return ObliqueViewer;
    default:
      return null;
  }
}
