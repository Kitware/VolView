import { UrlParams } from '@vueuse/core';
import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';
import { logError } from '@/src/utils/loggers';

// This module owns the tab's launch params (`urls=`, `names=`, `config=`,
// `save=`): both READING them at boot (readLaunchParams) and REWRITING them
// after a remote save (repointLaunchUrls). Keeping both sides here means the
// stale-`names=` interaction below stays next to the parsing it protects.

type ParsedUrlParams = {
  urls?: string[];
  names?: string[];
  config?: string[];
  save?: string | string[];
};

const isValidUrl = (str: string) => {
  try {
    return !!new URL(str.trim(), window.location.href);
  } catch {
    return false;
  }
};

const splitAndClean = (str: string) =>
  str
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

const parseUrlArray = (value: string | string[]): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((v) => parseUrlArray(v));
  }

  const trimmed = value.trim();

  if (!trimmed) return [];

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return splitAndClean(trimmed.slice(1, -1));
  }

  return [trimmed];
};

export const normalizeUrlParams = (rawParams: UrlParams): ParsedUrlParams => {
  const normalized: ParsedUrlParams = {};

  if (rawParams.urls) {
    const urls = parseUrlArray(rawParams.urls);
    const validUrls = urls.filter((url) => {
      const isValid = isValidUrl(url);
      if (!isValid) {
        logError(new Error(`Invalid URL in urls parameter: ${url}`));
      }
      return isValid;
    });

    if (validUrls.length > 0) {
      normalized.urls = validUrls;
    }
  }

  if (rawParams.names) {
    normalized.names = parseUrlArray(rawParams.names);
  }

  if (rawParams.config) {
    const configs = parseUrlArray(rawParams.config);
    const validConfigs = configs.filter((url) => {
      const isValid = isValidUrl(url);
      if (!isValid) {
        logError(new Error(`Invalid URL in config parameter: ${url}`));
      }
      return isValid;
    });

    if (validConfigs.length > 0) {
      normalized.config = validConfigs;
    }
  }

  if (rawParams.save) {
    normalized.save = rawParams.save;
  }

  return normalized;
};

// The current tab's launch params. Unparseable params degrade to an empty
// launch (logged), never a failed boot.
export const readLaunchParams = (): ParsedUrlParams => {
  try {
    return normalizeUrlParams(
      vtkURLExtract.extractURLParameters() as UrlParams
    );
  } catch (error) {
    logError(new Error(`Failed to parse URL parameters: ${error}`));
    return {};
  }
};

// On a successful remote save the backend returns `resumeUrl` — the saved
// session's load URL. Repoint ONLY the tab's `urls=` at it (so a future F5
// reloads the just-made save instead of the fresh launch manifest), via
// `history.replaceState` (no reload). `save=` and `config=` are untouched:
// every save keeps going to the launch-provided target.
export const repointLaunchUrls = (resumeUrl: string) => {
  const url = new URL(window.location.toString());
  url.searchParams.set('urls', resumeUrl);
  // A stale names= would rename the session zip after the original data file,
  // and filename-extension typing would then misparse the zip on reload.
  url.searchParams.delete('names');
  window.history.replaceState(null, '', url.toString());
};
