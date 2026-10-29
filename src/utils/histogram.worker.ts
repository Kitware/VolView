import * as Comlink from 'comlink';
import { histogram } from '@/src/utils/histogram';

export type HistogramWorker = {
  histogram: typeof histogram;
};

Comlink.expose({ histogram });
