import { newSumType } from '../utils/sumtypes';

export const ArgType = {
  Any: () => true,
  Integer: (n) => Number.isInteger(n),
  String: (a) => typeof a === 'string',
  Error: (a) => a instanceof Error,
  VtkObject: (a) => !!(a && a.isA instanceof Function && a.isA('vtkObject')),
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

export const Data = newSumType('Data', {
  VtkData: [
    ['id', ArgType.Integer],
    ['object', ArgType.VtkObject],
  ],
  DicomSeriesData: [
    ['id', ArgType.Integer],
    ['patientID', ArgType.String],
    ['studyUID', ArgType.String],
    ['seriesUID', ArgType.String],
  ],
});
