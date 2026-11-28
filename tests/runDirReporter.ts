import type { FullResult, Reporter } from '@playwright/test/reporter';
import { removeDir } from './globalSetup';
import { IS_CI, TEMP_DIR } from './e2eRun';

// Global teardown cannot see the run's result, so a reporter decides. A failed
// run keeps its directory for the traces and screenshots in it. CI keeps it
// either way, since a passing run is where a new baseline gets picked up.
// Playwright constructs reporters with `new`; the returned record stands in
// for the instance.
export default function runDirReporter(): Reporter {
  let status: FullResult['status'] | undefined;
  return {
    printsToStdio: () => false,
    onEnd: (result) => {
      status = result.status;
    },
    onExit: async () => {
      if (status === 'passed' && !IS_CI) removeDir(TEMP_DIR);
    },
  };
}
