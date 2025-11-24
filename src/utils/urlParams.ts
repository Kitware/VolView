import { UrlParams } from '@vueuse/core';
import { logError } from '@/src/utils/loggers';

type ParsedUrlParams = {
  urls?: string[];
  names?: string[];
  config?: string[];
  save?: string | string[];
};

const isValidUrl = (str: string) => {
  try {
    // eslint-disable-next-line no-new
    new URL(str.trim());
    return true;
  } catch {
    return false;
  }
};

const parseUrlArray = (value: string | string[]): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((v) => parseUrlArray(v));
  }

  const trimmed = value.trim();

  if (!trimmed) return [];

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    return inner
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
  }

  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
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
