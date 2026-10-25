export const HTTP_STATUS_OK = 200;
export const HTTP_STATUS_PARTIAL_CONTENT = 206;
export const HTTP_STATUS_REQUESTED_RANGE_NOT_SATISFIABLE = 416;

export class HttpNotFound extends Error {
  constructor(url: string) {
    super(`The following resource could not be found: ${url}`);
  }
}
