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
}: {
  rulers?: RulerTool;
  paint?: PaintTool;
  proxies?: ProxyWrapper;
  id?: IDGenerator;
} = {}) {
  const dependencies = {
    $rulers: rulers ?? new RulerTool(),
    $paint: paint ?? new PaintTool(),
    $proxies: proxies,
    $id: id ?? new IDGenerator(),
  };
  return () => dependencies;
}
