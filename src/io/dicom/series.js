export default class Series {
  constructor(data) {
    this.instanceUID = null;
    this.modality = null;
    this.number = null;
    this.date = null;
    this.time = null;
    this.description = null;

    if (data) {
      this.update(data);
    }
  }

  update(newData) {
    this.instanceUID = newData.instanceUID || this.instanceUID;
    this.modality = newData.modality || this.modality;
    this.number = newData.number || this.number;
    this.date = newData.date || this.date;
    this.time = newData.time || this.time;
    this.description = newData.description || this.description;
  }
}
