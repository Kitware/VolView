import { NOOP } from '@/src/constants';

/**
 * Recursively logs error causes
 * @param error
 */
export function logError(error: unknown) {
  let cur = error;
  while (cur) {
    if (cur !== error) {
      console.error('The above error was caused by:', cur);
    } else {
      console.error(cur);
    }

    if (cur instanceof Error) {
      cur = cur.cause;
    } else {
      cur = null;
    }
  }
}

const isProd = process.env.NODE_ENV === 'production';

export const debug = {
  debug: isProd ? NOOP : console.debug,
  log: isProd ? NOOP : console.log,
  info: isProd ? NOOP : console.info,
  warn: isProd ? NOOP : console.warn,
  error: isProd ? NOOP : console.error,
};
