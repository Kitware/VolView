// Avoid name conflicts with window.Image
export default class DicomImage {
  constructor(data) {
    this.instanceNumber = '';
    this.imageType = '';
    this.comments = '';
    this.filename = '';
    this.pixelData = null;
    this.rows = 0;
    this.cols = 0;
    this.minValue = 0;
    this.maxValue = 0;
    this.thumbnail = '';

    if (data) {
      this.update(data);
    }
  }

  update(newData) {
    this.instanceNumber = newData.instanceNumber || this.instanceNumber;
    this.imageType = newData.imageType || this.imageType;
    this.number = newData.number || this.number;
    this.date = newData.date || this.date;
    this.comments = newData.comments || this.comments;
    this.filename = newData.filename || this.filename;
    this.pixelData = newData.pixelData || this.pixelData;
    this.rows = newData.rows || this.rows;
    this.cols = newData.cols || this.cols;
    this.minValue = newData.minValue || this.minValue;
    this.maxValue = newData.maxValue || this.maxValue;
  }
}
