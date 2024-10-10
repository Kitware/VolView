import PaintTool from './tools/paint';

/**
 * Pinia plugin for injecting tool services.
 */
export function CorePiniaProviderPlugin({
  paint,
}: {
  paint?: PaintTool;
} = {}) {
  const dependencies = {
    $paint: paint ?? new PaintTool(),
  };
  return () => dependencies;
}
