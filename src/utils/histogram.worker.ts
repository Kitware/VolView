import * as Comlink from 'comlink';
import { histogram } from '@/src/utils/histogram';

export interface HistogramWorker {
  histogram: typeof histogram;
}

Comlink.expose({ histogram });
