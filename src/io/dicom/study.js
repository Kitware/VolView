export default class Study {
  constructor(data) {
    this.instanceUID = null;
    this.studyID = null;
    this.date = null;
    this.time = null;
    this.accessionNumber = null;
    this.description = null;

    this.series = [];

    if (data) {
      this.update(data);
    }
  }

  update(newData) {
    this.instanceUID = newData.instanceUID ?? this.instanceUID;
    this.studyID = newData.studyID ?? this.studyID;
    this.date = newData.date ?? this.date;
    this.time = newData.time ?? this.time;
    this.accessionNumber = newData.accessionNumber ?? this.accessionNumber;
    this.description = newData.description ?? this.description;
  }
}
