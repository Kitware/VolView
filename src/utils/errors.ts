/* eslint-disable import/prefer-default-export */
export class MultipleErrors extends Error {
  constructor(errors, msg = null) {
    super(msg || 'Multiple errors occurred');
    this.errors = errors;
  }
}
