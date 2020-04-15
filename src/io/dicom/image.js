export const PixelTypes = {
  Unknown: Float32Array,
  Binary: Int8Array,
  Integer32: Int32Array,
  UnsignedInteger32: Uint32Array,
  Float32: Float32Array,
};

// Avoid name conflicts with window.Image
export default class DicomImage {
  constructor(data) {
    this.instanceNumber = '';
    this.imageType = '';
    this.comments = '';
    this.filename = '';
    this.pixelData = null;
    this.rows = 0;
    this.cols = 0;
    this.minValue = null;
    this.maxValue = null;
    this.pixelType = 'Unknown';
    this.pixelSpacing = [1, 1, 1];
    this.position = [0, 0, 0];
    this.orientation = [1, 0, 0, 0, 1, 0]; // X/Y direction cosines
    this.sliceThickness = 1;

    if (data) {
      this.update(data);
    }
  }

  update(newData) {
    this.instanceNumber = newData.instanceNumber ?? this.instanceNumber;
    this.imageType = newData.imageType ?? this.imageType;
    this.number = newData.number ?? this.number;
    this.date = newData.date ?? this.date;
    this.comments = newData.comments ?? this.comments;
    this.filename = newData.filename ?? this.filename;
    this.pixelData = newData.pixelData ?? this.pixelData;
    this.rows = newData.rows ?? this.rows;
    this.cols = newData.cols ?? this.cols;
    this.minValue = newData.minValue ?? this.minValue;
    this.maxValue = newData.maxValue ?? this.maxValue;
    this.pixelType = newData.pixelType ?? this.pixelType;
    this.pixelSpacing = newData.pixelSpacing ?? this.pixelSpacing;
    this.position = newData.position ?? this.position;
    this.orientation = newData.orientation ?? this.orientation;
    this.sliceThickness = newData.sliceThickness ?? this.sliceThickness;
  }
}
