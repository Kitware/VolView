import { DICOMIO } from '../io/dicom';
import IDGenerator from './id';
import ProxyWrapper from './proxies';
import PaintTool from './tools/paint';

/**
 * Pinia plugin for injecting tool services.
 */
export function CorePiniaProviderPlugin({
  paint,
  proxies,
  id,
  dicomIO,
}: {
  paint?: PaintTool;
  proxies?: ProxyWrapper;
  id?: IDGenerator;
  dicomIO?: DICOMIO;
} = {}) {
  const dependencies = {
    $paint: paint ?? new PaintTool(),
    $proxies: proxies,
    $id: id ?? new IDGenerator(),
    $dicomIO: dicomIO ?? new DICOMIO(),
  };
  return () => dependencies;
}
