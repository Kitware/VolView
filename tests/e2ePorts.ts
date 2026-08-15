import { createHash } from 'crypto';
import { projectRoot } from './e2eTestUtils';

// Clear of the crowded low ports, and below the range operating systems hand
// out for outbound connections (32768+ on Linux, 49152+ on Windows), so nothing
// else on the machine is handed one while it sits unbound between runs.
const RANGE_START = 20000;
const RANGE_PAIRS = 5000;

/**
 * The same checkout path always derives the same ports and two checkouts derive
 * different ones, so every process in a run agrees without coordinating.
 */
function derivePort() {
  // Windows compares paths case-insensitively, so the same checkout reached
  // through a differently cased path has to hash the same.
  const root =
    process.platform === 'win32' ? projectRoot().toLowerCase() : projectRoot();
  const hashed = createHash('sha256').update(root).digest().readUInt32BE(0);
  return RANGE_START + (hashed % RANGE_PAIRS) * 2;
}

function overridable(name: string, derived: number) {
  const raw = process.env[name];
  if (!raw) return derived;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port number, got "${raw}"`);
  }
  return port;
}

const BASE = derivePort();

export const TEST_PORT = overridable('VOLVIEW_E2E_PORT', BASE);
// For a spec that needs a server of its own alongside the static one.
export const AUX_PORT = overridable('VOLVIEW_E2E_AUX_PORT', BASE + 1);

// The static server, which is also what the vite dev server proxies /tmp to.
export const BASE_URL = `http://localhost:${TEST_PORT}`;
