export const HTTP_STATUS_OK = 200;

export class HttpNotFound extends Error {
  constructor(url: string) {
    super(`The following resource could not be found: ${url}`);
  }
}
