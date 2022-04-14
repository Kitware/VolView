import 'pinia';
import { ToolManagers } from './core/tools/provider';

declare module 'pinia' {
  export interface PiniaCustomProperties {
    $tools: ToolManagers;
  }
}
