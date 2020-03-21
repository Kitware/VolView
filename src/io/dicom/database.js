export const PATIENT_UNKNOWN = 'UNKNOWN';

/* eslint-disable class-methods-use-this, no-unused-vars */
export default class DICOMDatabase {
  /**
   * Imports a DICOM file into the database
   * @param {File} file
   */
  async importFile(file) { throw new Error('Abstract'); }

  /**
   * Updates database after importing new files.
   *
   * This should be called after importing files.
   */
  async settleDatabase() { throw new Error('Abstract'); }

  /**
   * Returns map of patientID to Patient
   */
  getPatientIndex() { throw new Error('Abstract'); }

  /**
   * Returns a mapping from study UID a Study
   */
  getStudyIndex() { throw new Error('Abstract'); }

  /**
   * Returns a mapping from a series UID to a Series
   */
  getSeriesIndex() { throw new Error('Abstract'); }

  /**
   * Returns a mapping from a series UID to an array of DicomImages
   */
  getSeriesImages() { throw new Error('Abstract'); }

  /**
   * Gets the series dataset as a single vtkImageData, if applicable.
   * @param {String} seriesID
   * @returns vtkObject|null
   */
  async getSeriesAsVolume(seriesID) { throw new Error('Abstract'); }
}
/* eslint-enable */
