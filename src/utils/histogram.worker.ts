import * as Comlink from 'comlink';
import { histogram, piecewiseHistogram } from '@/src/utils/histogram';

export interface HistogramWorker {
  histogram: typeof histogram;
  piecewiseHistogram: typeof piecewiseHistogram;
}

Comlink.expose({ histogram, piecewiseHistogram });
