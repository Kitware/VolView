import Daikon from 'daikon';

import DICOMDatabase, { PATIENT_UNKNOWN } from './database';
import { readFileAsArrayBuffer } from '../io';
import Patient from './patient';
import Study from './study';
import Series from './series';
import DicomImage from './image';
import Tags from './tags';

function extractTagValue(image, tagId) {
  const tag = image.getTag(...tagId);
  return tag?.value ? tag.value[0] : null;
}

function extractPatientInfo(image) {
  return {
    patientID: image.getPatientID() || PATIENT_UNKNOWN,
    name: image.getPatientName(),
    sex: extractTagValue(image, Tags.PatientSex),
    comments: extractTagValue(image, Tags.PatientComments),
    birthDate: extractTagValue(image, Tags.PatientBirthDate),
  };
}

function extractStudyInfo(image) {
  return {
    instanceUID: extractTagValue(image, Tags.StudyInstanceUID),
    studyID: extractTagValue(image, Tags.StudyID),
    date: image.getStudyDate(),
    time: image.getStudyTime(),
    accessionNumber: extractTagValue(image, Tags.StudyAccessionNumber),
    description: extractTagValue(image, Tags.StudyDescription),
  };
}

function extractSeriesInfo(image) {
  return {
    instanceUID: image.getSeriesInstanceUID(),
    modality: image.getModality(),
    number: image.getSeriesNumber(),
    date: extractTagValue(image, Tags.SeriesDate),
    time: extractTagValue(image, Tags.SeriesTime),
    description: image.getSeriesDescription(),
  };
}

function extractImageInfo(image) {
  const imageData = image.getInterpretedData(false, true);
  return {
    instanceNumber: image.getImageNumber(),
    imageType: image.getImageType(),
    comments: extractTagValue(image, Tags.ImageComments),
    rows: image.getRows(),
    cols: image.getCols(),
    minValue: image.getImageMin() ?? imageData.min,
    maxValue: image.getImageMax() ?? imageData.max,
    pixelData: imageData.data,
  };
}

export default class DaikonDatabase extends DICOMDatabase {
  constructor() {
    super();

    // [{ seriesUID: string, filename: string, image: Daikon.Image }]
    this.$daikonImages = [];
    // SeriesInstanceUID -> Daikon.Series
    this.$daikonSeriesIndex = {};
    // PatientID -> Patient
    this.$patientIndex = {};
    // StudyInstanceUID -> Study
    this.$studyIndex = {};
    // SeriesInstanceUID -> Series
    this.$seriesIndex = {};
    // Daikon.Image -> DicomImage
    this.$imageMap = new Map();
    // SeriesInstanceUID -> DicomImage[]
    this.$seriesImageOrder = {};
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

    if (!this.findDaikonImage(image, file.name)) {
      this.addDaikonImage(image, file.name);
    }
  }

  async settleDatabase() {
    for (let i = 0; i < this.$daikonImages.length; i += 1) {
      const { filename, image } = this.$daikonImages[i];

      const patientInfo = extractPatientInfo(image);
      if (!(patientInfo.patientID in this.$patientIndex)) {
        const patient = new Patient(patientInfo);
        this.$patientIndex[patient.patientID] = patient;
      }

      const studyInfo = extractStudyInfo(image);
      if (!(studyInfo.instanceUID in this.$studyIndex)) {
        const study = new Study(studyInfo);
        this.$studyIndex[study.instanceUID] = study;
        // add study to patient
        this.$patientIndex[patientInfo.patientID].studies.push(
          studyInfo.instanceUID,
        );
      }

      const seriesInfo = extractSeriesInfo(image);
      if (!(seriesInfo.instanceUID in this.$seriesIndex)) {
        const series = new Series(seriesInfo);
        this.$seriesIndex[series.instanceUID] = series;
        // add series to study
        this.$studyIndex[studyInfo.instanceUID].series.push(
          seriesInfo.instanceUID,
        );
      }

      const imageInfo = extractImageInfo(image);
      Object.assign(imageInfo, { filename });
      if (!this.$imageMap.has(image)) {
        this.$imageMap.set(image, new DicomImage(imageInfo));
      }
    }

    // update image ordering
    const order = {};
    Object.keys(this.$daikonSeriesIndex).forEach((seriesUID) => {
      const series = this.$daikonSeriesIndex[seriesUID];
      series.buildSeries();
      order[seriesUID] = series.images.map((image) => this.$imageMap.get(image));
    });

    this.$seriesImageOrder = order;
  }

  findDaikonImage(image, filename) {
    const seriesUID = image.getSeriesInstanceUID();
    return this.$daikonImages.find((imgInfo) => imgInfo.filename === filename
      && imgInfo.seriesUID === seriesUID);
  }

  addDaikonImage(image, filename) {
    const seriesUID = image.getSeriesInstanceUID();
    if (!(seriesUID in this.$daikonSeriesIndex)) {
      this.$daikonSeriesIndex[seriesUID] = new Daikon.Series();
    }

    this.$daikonSeriesIndex[seriesUID].addImage(image);
    this.$daikonImages.push({
      seriesUID,
      image,
      filename,
    });
  }

  getPatientIndex() { return this.$patientIndex; }

  getStudyIndex() { return this.$studyIndex; }

  getSeriesIndex() { return this.$seriesIndex; }

  getSeriesImages() { return this.$seriesImageOrder; }

  async getSeriesAsVolume(seriesID) {
    return new Promise((resolve, reject) => {
      if (seriesID in this.$daikonSeriesIndex) {
        const series = this.$daikonSeriesIndex[seriesID];
        series.concatenateImageData(null, resolve);
      } else {
        reject(new Error(`Cannot find series ${seriesID}`));
      }
    });
  }
}
