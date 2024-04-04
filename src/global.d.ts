import 'pinia';
import type { Framework } from 'vuetify/types';
import PaintTool from './core/tools/paint';
import { DICOMIO } from './io/dicom';

declare module 'pinia' {
  export interface PiniaCustomProperties {
    // from CorePiniaProviderPlugin
    $paint: PaintTool;
    $dicomIO: DICOMIO;
  }
}

declare module 'vue/types/vue' {
  interface Vue {
    $vuetify: Framework;
  }
}
