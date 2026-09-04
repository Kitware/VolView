import { usePaintProcessStore } from '@/src/store/tools/paintProcess';
import { rasterizePolygon } from './rasterizeTarget';

export function rasterizePolygonEdit(
  options: Parameters<typeof rasterizePolygon>[0]
) {
  usePaintProcessStore().cancelProcess();
  return rasterizePolygon(options);
}
