import 'pinia';
import 'jquery';
import type { Framework } from 'vuetify/types';
import ProxyWrapper from './core/proxies';
import PaintTool from './core/tools/paint';
import { DICOMIO } from './io/dicom';

declare module 'pinia' {
  export interface PiniaCustomProperties {
    // from CorePiniaProviderPlugin
    $paint: PaintTool;
    $proxies: ProxyWrapper;
    $dicomIO: DICOMIO;
  }
}

declare module 'vue/types/vue' {
  interface Vue {
    $vuetify: Framework;
  }
}

declare module 'jquery' {
  export interface $ {

  }
}
