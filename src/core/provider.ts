import IDManager from './id';
import ProxyManager from './proxies';
import PaintToolManager from './tools/paint/manager';
import RulerToolManager from './tools/ruler';

export function provideToolManagers() {
  return {
    ruler: new RulerToolManager(),
    paint: new PaintToolManager(),
  };
}

export type ToolManagers = ReturnType<typeof provideToolManagers>;

/**
 * Pinia plugin for injecting tool services.
 */
export function CorePiniaProviderPlugin({
  toolManagers,
  proxyManager,
  idManager,
}: {
  toolManagers?: ReturnType<typeof provideToolManagers>;
  proxyManager: ProxyManager;
  idManager?: IDManager;
}) {
  return () => ({
    $tools: toolManagers ?? provideToolManagers(),
    $proxies: proxyManager,
    $id: idManager ?? new IDManager(),
  });
}
