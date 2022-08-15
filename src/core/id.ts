const START_ID = 0;

export default class IDGenerator {
  private id: number;

  constructor() {
    this.id = START_ID;
  }

  nextID() {
    this.id += 1;
    return String(this.id);
  }

  reset() {
    this.id = START_ID;
  }
}
