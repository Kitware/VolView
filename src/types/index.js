import { newSumType } from '../utils/sumtypes';

export const ArgType = {
  Any: () => true,
  String: (a) => typeof a === 'string',
  Error: (a) => a instanceof Error,
  VtkObject: (a) => !!(a && a.vtkClass),
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
    ['object', ArgType.VtkObject],
  ],
  DicomSeriesData: [
    ['patientID', ArgType.String],
    ['studyUID', ArgType.String],
    ['seriesUID', ArgType.String],
  ],
});
