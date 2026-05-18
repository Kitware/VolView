import SliceViewer from '@/src/components/SliceViewer.vue';
import VolumeViewer from '@/src/components/VolumeViewer.vue';
import ObliqueViewer from '@/src/components/ObliqueViewer.vue';
import CineViewer from '@/src/components/CineViewer.vue';
import { ViewInfo, ViewType } from '@/src/types/views';
import { Maybe } from '@/src/types';
import {
  computeEffectiveView,
  EffectiveView,
} from '@/src/core/views/effectiveView';

type ViewComponent =
  | typeof SliceViewer
  | typeof VolumeViewer
  | typeof ObliqueViewer
  | typeof CineViewer;

function pickComponent(kind: EffectiveView['kind'], fallbackType: ViewType) {
  switch (kind) {
    case 'cine':
      return CineViewer;
    case 'volume2D':
      return SliceViewer;
    case 'volume3D':
      return VolumeViewer;
    case 'oblique':
      return ObliqueViewer;
    case 'empty':
      if (fallbackType === '2D') return SliceViewer;
      if (fallbackType === '3D') return VolumeViewer;
      return ObliqueViewer;
    default:
      return null;
  }
}

export function resolveSlotRendering(viewInfo: ViewInfo): {
  component: Maybe<ViewComponent>;
  renderImageID: Maybe<string>;
} {
  const effective = computeEffectiveView(viewInfo, viewInfo.dataID);
  return {
    component: pickComponent(effective.kind, effective.viewInfo.type),
    renderImageID: effective.renderDataID,
  };
}
