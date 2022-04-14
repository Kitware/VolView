import RulerToolManager from './ruler';

export function provideToolManagers() {
  return {
    ruler: new RulerToolManager(),
  };
}

export type ToolManagers = ReturnType<typeof provideToolManagers>;

/**
 * Pinia plugin for injecting tool services.
 */
export function ToolManagerPiniaPlugin(
  toolManagers?: ReturnType<typeof provideToolManagers>
) {
  return () => ({
    $tools: toolManagers ?? provideToolManagers(),
  });
}
