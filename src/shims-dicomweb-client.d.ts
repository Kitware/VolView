declare module 'dicomweb-client' {
  type DICOMwebClientOptions = {
    url: string;
    retrieveRendered?: boolean;
    verbose?: boolean;
  };
  class DICOMwebClient {
    constructor(options: DICOMwebClientOptions);
    searchForSeries(): any[];
    retrieveSeries(options: any): ArrayBuffer[];
    searchForInstances(): any[];
    retrieveInstance(options: any): ArrayBuffer;
    retrieveSeriesMetadata(options: any): any[];

    retrieveInstanceThumbnail(options: any): any;
    retrieveInstanceFrames(options: any): any;
    retrieveInstanceFramesRendered(options: any): any;
  }
  const api = {
    DICOMwebClient,
  };
  export { api };
}
