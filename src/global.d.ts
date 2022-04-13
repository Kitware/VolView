import 'pinia';
import { ToolManagers } from './tools/provider';

declare module 'pinia' {
  export interface PiniaCustomProperties {
    $tools: ToolManagers;
  }
}
