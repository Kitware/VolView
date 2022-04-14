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
}: {
  toolManagers?: ReturnType<typeof provideToolManagers>;
}) {
  return () => ({
    $tools: toolManagers ?? provideToolManagers(),
  });
}
