import ProxyManager from './proxies';
import RulerToolManager from './tools/ruler';

export function provideToolManagers() {
  return {
    ruler: new RulerToolManager(),
  };
}

export type ToolManagers = ReturnType<typeof provideToolManagers>;

/**
 * Pinia plugin for injecting tool services.
 */
export function CorePiniaProviderPlugin({
  toolManagers,
  proxyManager,
}: {
  toolManagers?: ReturnType<typeof provideToolManagers>;
  proxyManager: ProxyManager;
}) {
  return () => ({
    $tools: toolManagers ?? provideToolManagers(),
    $proxies: proxyManager,
  });
}
