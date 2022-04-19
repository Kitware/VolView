import 'pinia';
import IDManager from './core/id';
import ProxyManager from './core/proxies';
import { ToolManagers } from './core/provider';

declare module 'pinia' {
  export interface PiniaCustomProperties {
    $tools: ToolManagers;
    $proxies: ProxyManager;
    $id: IDManager;
  }
}
