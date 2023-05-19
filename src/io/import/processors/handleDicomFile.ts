import { ImportHandler } from '@/src/io/import/common';

/**
 * Adds DICOM files to the extra context.
 * @param dataSource
 * @returns
 */
const handleDicomFile: ImportHandler = (dataSource, { extra, done }) => {
  const { fileSrc } = dataSource;
  if (extra?.dicomDataSources && fileSrc?.fileType === 'application/dicom') {
    extra.dicomDataSources.push(dataSource);
    return done();
  }
  return dataSource;
};

export default handleDicomFile;
