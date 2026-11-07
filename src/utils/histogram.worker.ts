import * as Comlink from 'comlink';
import { histogram, piecewiseHistogram } from '@/src/utils/histogram';

export type HistogramWorker = {
  histogram: typeof histogram;
  piecewiseHistogram: typeof piecewiseHistogram;
};

Comlink.expose({ histogram, piecewiseHistogram });
