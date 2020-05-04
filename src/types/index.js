import { newSumType } from '../utils/sumtypes';

export const ArgType = {
  Any: () => true,
  String: (a) => typeof a === 'string',
  Error: (a) => a instanceof Error,
};

export const FileLoaded = newSumType('FileLoaded', {
  Success: [
    ['file', ArgType.String],
    ['value', ArgType.Any],
  ],
  Failure: [
    ['file', ArgType.String],
    ['error', ArgType.Error],
  ],
});
