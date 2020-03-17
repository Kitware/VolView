import Daikon from 'daikon';

import DICOMDatabase, { PATIENT_UNSPECIFIED } from './database';
import { readFileAsArrayBuffer } from '../io';
import Patient from './patient';
import Study from './study';
import Series from './series';
import Image from './image';

function extractValue(tag) {
  return tag.value ? tag.value[0] : null;
}

export default class DaikonDatabase extends DICOMDatabase {
  constructor() {
    super();
    this.$daikonSeries = {}; // seriesId -> Daikon.Series
    this.$patients = [];
    this.$patientTable = {}; // patientID -> Patient
    this.$patientStudies = {}; // patientID -> Study[]
    this.$studyTable = {}; // studyID -> Study
    this.$studySeries = {}; // studyID -> Series[]
    this.$seriesTable = {}; // seriesID -> Series
    this.$seriesImages = {}; // seriesID -> Image[]
  }

  async importFile(file) {
    const buf = await readFileAsArrayBuffer(file);
    const image = Daikon.Series.parseImage(new DataView(buf));
    if (!image) {
      throw new Error(`Failed to read image from ${file.name}`);
    }
    if (!image.hasPixelData()) {
      throw new Error(`Image ${file.name} did not have pixel data`);
    }

    const seriesUID = image.getSeriesInstanceUID();

    // ensure we don't add a duplicate
    if (this.$seriesImages[seriesUID]) {
      const instanceNumber = image.getImageNumber();
      const dup = this.$seriesImages[seriesUID].find((im) => (im.instanceNumber === instanceNumber)
        && file.name === im.filename);
      if (dup) {
        return;
      }
    }

    // add image to daikon Series
    if (!(seriesUID in this.$daikonSeries)) {
      this.$daikonSeries[seriesUID] = new Daikon.Series();
    }
    this.$daikonSeries[seriesUID].addImage(image);

    this.updateDB(image, file.name);
  }

  async postProcess() {
    Object.keys(this.$daikonSeries).forEach((id) => {
      this.$daikonSeries[id].buildSeries();
      // TODO re-order $seriesImages
    });
  }

  getPatients() { return this.$patients; }

  getPatientStudyMap() { return this.$patientStudies; }

  getStudySeriesMap() { return this.$studySeries; }

  getSeriesImagesMap() { return this.$seriesImages; }

  async getSeriesAsDataset(seriesID) {
    return new Promise((resolve, reject) => {
      const series = this.$daikonSeries[seriesID];
      if (series) {
        series.concatenateImageData(null, resolve);
      } else {
        reject(new Error(`Cannot find series ${seriesID}`));
      }
    });
  }

  updateDB(daikonImage, filename) {
    const patientID = daikonImage.getPatientID() || PATIENT_UNSPECIFIED;
    if (!(patientID in this.$patientTable)) {
      const newPatient = new Patient({ patientID });
      this.$patients.push(newPatient);
      this.$patientTable[patientID] = newPatient;
      this.$patientStudies[patientID] = [];
    }

    const patientData = {
      name: daikonImage.getPatientName(),
      birthDate: extractValue(daikonImage.getTag(0x0010, 0x0030)),
      sex: extractValue(daikonImage.getTag(0x0010, 0x0040)),
      comments: extractValue(daikonImage.getTag(0x0010, 0x4000)),
    };
    const patient = this.$patientTable[patientID];
    patient.update(patientData);

    const studyInstanceUID = extractValue(daikonImage.getTag(0x0020, 0x000D));
    if (!(studyInstanceUID in this.$studyTable)) {
      const newStudy = new Study({ instanceUID: studyInstanceUID });
      this.$patientStudies[patientID].push(newStudy);
      this.$studyTable[studyInstanceUID] = newStudy;
      this.$studySeries[studyInstanceUID] = [];
    }

    const studyData = {
      studyID: extractValue(daikonImage.getTag(0x0020, 0x0010)),
      date: daikonImage.getStudyDate(),
      time: daikonImage.getStudyTime(),
      accessionNumber: extractValue(daikonImage.getTag(0x0008, 0x0050)),
      description: extractValue(daikonImage.getTag(0x0008, 0x1030)),
    };
    const study = this.$studyTable[studyInstanceUID];
    study.update(studyData);

    const seriesInstanceUID = daikonImage.getSeriesInstanceUID();
    if (!(seriesInstanceUID in this.$seriesTable)) {
      const newSeries = new Series({ instanceUID: seriesInstanceUID });
      this.$studySeries[studyInstanceUID].push(newSeries);
      this.$seriesTable[seriesInstanceUID] = newSeries;
      this.$seriesImages[seriesInstanceUID] = [];
    }

    const seriesData = {
      modality: daikonImage.getModality(),
      number: daikonImage.getSeriesNumber(),
      date: extractValue(daikonImage.getTag(0x0008, 0x0021)),
      time: extractValue(daikonImage.getTag(0x0008, 0x0031)),
      description: daikonImage.getSeriesDescription(),
    };
    const series = this.$seriesTable[seriesInstanceUID];
    series.update(seriesData);

    const image = new Image({
      instanceNumber: daikonImage.getImageNumber(),
      imageType: daikonImage.getImageType(),
      comments: extractValue(daikonImage.getTag(0x0020, 0x4000)),
      filename,
      pixelData: daikonImage.getInterpretedData(false, false),
      rows: daikonImage.getRows(),
      cols: daikonImage.getCols(),
      minValue: daikonImage.getImageMin(),
      maxValue: daikonImage.getImageMax(),
    });
    this.$seriesImages[seriesInstanceUID].push(image);
  }
}
