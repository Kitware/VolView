import 'pinia';
import type { Framework } from 'vuetify/types';
import IDGenerator from './core/id';
import ProxyWrapper from './core/proxies';
import PaintTool from './core/tools/paint';
import { DICOMIO } from './io/dicom';

declare module 'pinia' {
  export interface PiniaCustomProperties {
    // from CorePiniaProviderPlugin
    $paint: PaintTool;
    $proxies: ProxyWrapper;
    $id: IDGenerator;
    $dicomIO: DICOMIO;
  }
}

declare module 'vue/types/vue' {
  interface Vue {
    $vuetify: Framework;
  }
}
