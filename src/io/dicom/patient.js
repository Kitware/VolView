export default class Patient {
  constructor(data) {
    this.patientID = null;
    this.name = null;
    this.birthDate = null;
    this.sex = null;
    this.comments = null;

    this.studies = [];

    if (data) {
      this.update(data);
    }
  }

  update(newData) {
    this.patientID = newData.patientID || this.patientID;
    this.name = newData.name || this.name;
    this.birthDate = newData.birthDate || this.birthDate;
    this.sex = newData.sex || this.sex;
    this.comments = newData.comments || this.comments;
  }
}
