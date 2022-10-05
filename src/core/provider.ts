import { DICOMIO } from '../io/dicom';
import IDGenerator from './id';
import ProxyWrapper from './proxies';
import PaintTool from './tools/paint';
import RulerTool from './tools/ruler';

/**
 * Pinia plugin for injecting tool services.
 */
export function CorePiniaProviderPlugin({
  rulers,
  paint,
  proxies,
  id,
  dicomIO,
}: {
  rulers?: RulerTool;
  paint?: PaintTool;
  proxies?: ProxyWrapper;
  id?: IDGenerator;
  dicomIO?: DICOMIO;
} = {}) {
  const dependencies = {
    $rulers: rulers ?? new RulerTool(),
    $paint: paint ?? new PaintTool(),
    $proxies: proxies,
    $id: id ?? new IDGenerator(),
    $dicomIO: dicomIO ?? new DICOMIO(),
  };
  return () => dependencies;
}
