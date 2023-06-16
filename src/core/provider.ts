import { DICOMIO } from '../io/dicom';
import ProxyWrapper from './proxies';
import PaintTool from './tools/paint';

/**
 * Pinia plugin for injecting tool services.
 */
export function CorePiniaProviderPlugin({
  paint,
  proxies,
  dicomIO,
}: {
  paint?: PaintTool;
  proxies?: ProxyWrapper;
  dicomIO?: DICOMIO;
} = {}) {
  const dependencies = {
    $paint: paint ?? new PaintTool(),
    $proxies: proxies,
    $dicomIO: dicomIO ?? new DICOMIO(),
  };
  return () => dependencies;
}
