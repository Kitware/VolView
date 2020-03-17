export const PATIENT_UNSPECIFIED = 'UNSPECIFIED';

/* eslint-disable class-methods-use-this, no-unused-vars */
export default class DICOMDatabase {
  /**
   * Imports a DICOM file into the database
   * @param {File} file
   */
  async importFile(file) { throw new Error('Abstract'); }

  /**
   * Run any post-processing tasks.
   */
  async postProcess() { throw new Error('Abstract'); }

  /**
   * Returns a list of patients.
   */
  getPatients() { throw new Error('Abstract'); }

  /**
   * Returns a mapping from patient ID to an array of studies.
   */
  getPatientStudyMap() { throw new Error('Abstract'); }

  /**
   * Returns a mapping from a study UID to an array of series.
   */
  getStudySeriesMap() { throw new Error('Abstract'); }

  /**
   * Returns a mapping from a series UID to an array of images.
   *
   * Order of images may be affected by calls to postProcess().
   */
  getSeriesImagesMap() { throw new Error('Abstract'); }

  /**
   * Gets the series dataset as a single vtkObject, if applicable.
   * @param {String} seriesID
   * @returns vtkObject|null
   */
  async getSeriesAsDataset(seriesID) { throw new Error('Abstract'); }
}
/* eslint-enable */
