export interface CropLine<T> {
  startEdge: T;
  startCrop: T;
  endCrop: T;
  endEdge: T;
}

export interface CropLines<T> {
  lowerLine: CropLine<T>;
  upperLine: CropLine<T>;
}
