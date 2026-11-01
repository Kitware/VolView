import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_ENV !== 'production') {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.resolve('patch-package')), '--error-on-fail'],
    { stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
