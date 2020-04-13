import Daikon from 'daikon';

import DICOMDatabase, { PATIENT_UNKNOWN } from './database';
import { readFileAsArrayBuffer } from '../io';
import Patient from './patient';
import Study from './study';
import Series from './series';
import DicomImage, { PixelTypes } from './image';
import Tags from './tags';

const DataTypes = {
  [Daikon.Image.BYTE_TYPE_UNKNOWN]: 'Unknown',
  [Daikon.Image.BYTE_TYPE_BINARY]: 'Binary',
  [Daikon.Image.BYTE_TYPE_INTEGER]: 'Integer32',
  [Daikon.Image.BYTE_TYPE_INTEGER_UNSIGNED]: 'UnsignedInteger32',
  [Daikon.Image.BYTE_TYPE_FLOAT]: 'Float32',
};

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

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
  const imageData = image.getInterpretedData(false, true /* imageStats */);
  return {
    instanceNumber: image.getImageNumber(),
    imageType: image.getImageType(),
    comments: extractTagValue(image, Tags.ImageComments),
    rows: image.getRows(),
    cols: image.getCols(),
    minValue: image.getImageMin() ?? imageData.min,
    maxValue: image.getImageMax() ?? imageData.max,
    pixelData: imageData.data,
    pixelType: DataTypes[image.getDataType()] || 'Unknown',
    pixelSpacing: image.getPixelSpacing(),
    position: image.getImagePosition(),
    sliceThickness: image.getSliceThickness(),
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
    const images = this.$seriesImageOrder[seriesID];
    if (images) {
      const image0 = images[0];
      // assume first image defines origin of entire volume
      const origin = image0.position;
      const spacing = [
        ...image0.pixelSpacing,
        image0.sliceThickness,
      ];
      const dir0 = image0.orientation;
      const directions = [
        ...dir0,
        cross(dir0.slice(0, 3), dir0.slice(3, 6)),
      ];
      const TypeCtor = PixelTypes[image0.pixelType];
      const size2 = image0.rows * image0.cols;
      const pixelData = new TypeCtor(size2 * images.length);

      for (let i = 0, off = 0; i < images.length; i += 1, off += size2) {
        pixelData.set(images[i].pixelData, off);
      }

      return {
        origin,
        spacing,
        directions,
        pixelData,
      };
    }
    return null;
  }
}
