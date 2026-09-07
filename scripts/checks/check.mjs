import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.CHECKS_SKIP === '1') {
  console.log('Additional checks skipped (CHECKS_SKIP=1).');
} else {
  for (const script of ['complexity.mjs', 'duplication.mjs', 'conventions.mjs']) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL(script, import.meta.url)),
        ...process.argv.slice(2),
      ],
      { stdio: 'inherit' }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = 1;
  }
}
