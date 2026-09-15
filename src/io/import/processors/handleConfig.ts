import { ZodError, z } from 'zod';
import { ImportHandler, asConfigResult } from '@/src/io/import/common';
import { ensureError, plural } from '@/src/utils';
import { recognizeConfigFile } from '@/src/io/import/configJson';
import { Skip } from '@/src/utils/evaluateChain';
import { surfaceWarning } from '@/src/store/messages';

// Forward-compat: a config that carries unknown top-level keys (e.g. a newer
// config opened on an older client) still applies its known sections; the
// unknown keys are stripped during recognition and surfaced here (console +
// user-visible notification naming them) so the skew is visible, not silent.
const surfaceIgnoredConfigKeys = (ignoredKeys: string[]) => {
  const label = plural(ignoredKeys.length, 'key');
  const message = `Ignored unrecognized config ${label}: ${ignoredKeys.join(
    ', '
  )}.`;
  surfaceWarning('Unrecognized configuration', message);
};

/**
 * Recognizes a JSON file as VolView config BY SHAPE — no channel distinction:
 * trust for the `processing` section attaches to the provider's origin (see
 * io/originGate), not to how the config arrived. A recognized config is emitted
 * as a config result; anything else falls through (`Skip`) to normal data
 * import. A config-shaped JSON carrying unknown top-level keys still applies its
 * known sections (forward-compat). The stripped keys are surfaced as a warning,
 * as are the legacy keys recognition converted or ignored.
 */
const handleConfig: ImportHandler = async (dataSource) => {
  if (
    dataSource.type !== 'file' ||
    dataSource.fileType !== 'application/json'
  ) {
    return Skip;
  }
  try {
    const recognition = await recognizeConfigFile(dataSource.file);
    if (recognition.kind === 'config') {
      if (recognition.ignoredKeys.length > 0) {
        surfaceIgnoredConfigKeys(recognition.ignoredKeys);
      }
      if (recognition.deprecations.length > 0) {
        surfaceWarning(
          'Deprecated configuration',
          recognition.deprecations.join(' ')
        );
      }
      return asConfigResult(dataSource, recognition.config);
    }
    return Skip;
  } catch (err) {
    const error = ensureError(err);
    const detail =
      err instanceof ZodError ? z.prettifyError(err) : error.message;
    throw new Error(`Failed to parse config file: ${detail}`, {
      cause: error,
    });
  }
};

export default handleConfig;
