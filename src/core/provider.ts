import { DICOMIO } from '../io/dicom';
import PaintTool from './tools/paint';

/**
 * Pinia plugin for injecting tool services.
 */
export function CorePiniaProviderPlugin({
  paint,
  dicomIO,
}: {
  paint?: PaintTool;
  dicomIO?: DICOMIO;
} = {}) {
  const dependencies = {
    $paint: paint ?? new PaintTool(),
    $dicomIO: dicomIO ?? new DICOMIO(),
  };
  return () => dependencies;
}
