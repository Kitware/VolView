export default class Image {
  constructor(data) {
    this.instanceNumber = null;
    this.imageType = null;
    this.comments = null;
    this.filename = null;
    this.pixelData = null;
    this.rows = null;
    this.cols = null;
    this.minValue = null;
    this.maxValue = null;

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
