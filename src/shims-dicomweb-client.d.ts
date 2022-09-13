declare module 'dicomweb-client' {
  class DICOMwebClient {
    constructor({ url: string, retrieveRendered: boolean });
    searchForSeries(): any[];
    retrieveSeries(options: any): ArrayBuffer[];
    searchForInstances(): any[];
    retrieveInstance(options: any): ArrayBuffer;
  }
  const api = {
    DICOMwebClient,
  };
  export { api };
}
